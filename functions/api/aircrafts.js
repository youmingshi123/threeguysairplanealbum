const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const random = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const digest = async s => hex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
const live = "SELECT username FROM sessions WHERE token = ? AND expires > unixepoch()";

function check(ok, status, message) {
  if (!ok) throw Object.assign(new Error(message), { status });
}

async function passwordHash(password, salt = random(16)) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = Uint8Array.from(salt.match(/../g), b => parseInt(b, 16));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256",
    iterations: 100000, salt: bytes }, key, 256);
  return salt + "." + hex(bits);
}

async function body(req) {
  check(req.headers.get("Content-Type")?.split(";")[0].trim() === "application/json", 415, "请发送 JSON");
  const raw = await req.text();
  check(encoder.encode(raw).length <= 1500000, 413, "全量数据超过 1.5 MB");
  try { return JSON.parse(raw); } catch { check(false, 400, "JSON 格式错误"); }
}

async function snapshot(db) {
  const [meta, rows] = await db.batch([
    db.prepare("SELECT version FROM gallery WHERE id = 1"),
    db.prepare("SELECT * FROM aircrafts ORDER BY reg")
  ]);
  return { version: meta.results[0].version,
    rows: rows.results.map(a => ({ ...a, photos: JSON.parse(a.photos) })) };
}

function cleanText(s, max, optional = false) {
  check(typeof s === "string" && s.trim().length <= max && (optional || s.trim()), 400, "字段为空或过长");
  return s.trim();
}

function imageUrl(s, origin) {
  let url;
  try { url = new URL(s); } catch { check(false, 400, "图片地址无效"); }
  check(url.protocol === "https:" && url.origin === origin && !url.username && !url.password &&
    url.pathname.startsWith("/file/"), 400, "图片地址不属于配置的图床");
  return url.href;
}

function normalize(rows, origin) {
  check(Array.isArray(rows), 400, "需要完整飞机数组");
  const ids = new Set(), regs = new Set();
  return rows.map(a => {
    check(a && Array.isArray(a.photos), 400, "照片列表无效");
    const id = cleanText(String(a.id ?? ""), 80), reg = cleanText(a.reg, 40).toUpperCase();
    check(!ids.has(id) && !regs.has(reg), 400, "飞机 ID 或注册号重复");
    ids.add(id); regs.add(reg);
    const photos = a.photos.map(p => {
      check(p && /^\d{4}-\d{2}-\d{2}$/.test(p.date), 400, "拍摄日期无效");
      const date = new Date(p.date + "T00:00:00Z");
      check(Number.isFinite(+date) && date.toISOString().startsWith(p.date + "T"), 400, "拍摄日期无效");
      const photo = { url: imageUrl(p.url, origin), uploader: cleanText(p.uploader, 40), date: p.date };
      if (p.originalUrl) photo.originalUrl = imageUrl(p.originalUrl, origin);
      return photo;
    });
    return { id, reg, model: cleanText(a.model, 120), airline: cleanText(a.airline, 120),
      livery: cleanText(a.livery ?? "", 120, true), photos };
  });
}

// 比较其他成员的照片，包括所属飞机、署名、日期和原图，保留重复项的数量。
function protectedPhotos(rows, user) {
  return rows.flatMap(a => a.photos.filter(p => p.uploader !== user)
    .map(p => JSON.stringify([String(a.id), p.url, p.originalUrl || p.url, p.uploader, p.date]))).sort();
}

export async function onRequest({ request: req, env }) {
  const url = new URL(req.url), origin = req.headers.get("Origin");
  const allowed = !origin || origin === url.origin || origin === env.APP_ORIGIN;
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gallery-Version",
    "Access-Control-Expose-Headers": "X-Gallery-Version, X-Image-Origin" });
  if (origin && allowed) headers.set("Access-Control-Allow-Origin", origin);
  const send = (value, status = 200) => Response.json(value, { status, headers });
  try {
    check(allowed, 403, "来源未获允许");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const route = url.pathname.replace(/\/$/, "").split("/").pop();
    check(["login", "logout", "change-password", "aircrafts"].includes(route), 404, "接口不存在");
    check(req.method === "POST" || (req.method === "GET" && route === "aircrafts"), 405, "请求方法错误");
    const db = env.DB;
    if (route === "login") {
      const input = await body(req);
      const name = cleanText(input?.username, 40), pw = input?.password;
      check(typeof pw === "string" && pw.length <= 256, 400, "密码格式错误");
      const row = await db.prepare("SELECT password FROM users WHERE username=?").bind(name).first();
      const encoded = await passwordHash(pw, row?.password.split(".")[0] || "00".repeat(16));
      check(row && row.password === encoded, 401, "用户名或密码错误");
      const token = random(32);
      const [, inserted] = await db.batch([
        db.prepare("DELETE FROM sessions WHERE expires <= unixepoch()"),
        db.prepare(`INSERT INTO sessions SELECT ?, username, unixepoch()+43200 FROM users
          WHERE username=? AND password=?`).bind(await digest(token), name, encoded)
      ]);
      check(inserted.meta.changes, 401, "账号已变更，请重新登录");
      return send({ success: true, username: name, token });
    }
    const bearer = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get("Authorization") || "");
    check(bearer, 401, "请登录");
    const token = await digest(bearer[1]);
    const session = await db.prepare(live).bind(token).first();
    check(session, 401, "登录已过期");
    const user = session.username;
    if (route === "logout") {
      await db.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
      return send({ success: true });
    }
    if (route === "change-password") {
      const data = await body(req);
      check(data?.oldUsername === user, 403, "只能修改自己的账号");
      const name = cleanText(data.newUsername, 40), pw = data.newPassword;
      check(typeof pw === "string" && pw.length >= 8 && pw.length <= 256, 400, "新密码须为 8 至 256 个字符");
      const result = await db.prepare(`UPDATE users SET username=?, password=?
        WHERE username=? AND username=(${live})`).bind(name, await passwordHash(pw), user, token).run();
      check(result.meta.changes, 401, "请重新登录");
      return send({ success: true });
    }
    const current = await snapshot(db);
    const originBed = new URL(env.IMG_ORIGIN || "https://imgbed.example.com").origin;
    if (req.method === "GET") {
      headers.set("X-Image-Origin", originBed);
      headers.set("X-Gallery-Version", current.version);
      return send(current.rows);
    }
    const expected = req.headers.get("X-Gallery-Version");
    check(expected === current.version, 409, "图库已更新，请按最新内容重试");
    const next = normalize(await body(req), originBed);
    check(JSON.stringify(protectedPhotos(current.rows, user)) === JSON.stringify(protectedPhotos(next, user)),
      403, "只能添加或删除自己署名的照片");
    const version = random(16);
    const [guard] = await db.batch([
      db.prepare(`UPDATE gallery SET version=? WHERE id=1 AND version=? AND EXISTS (${live})`)
        .bind(version, expected, token),
      db.prepare("DELETE FROM aircrafts WHERE (SELECT version FROM gallery WHERE id=1)=?").bind(version),
      db.prepare(`INSERT INTO aircrafts(id,reg,model,airline,livery,photos)
        SELECT value->>'$.id',value->>'$.reg',value->>'$.model',value->>'$.airline',
        value->>'$.livery',value->'$.photos' FROM json_each(?)
        WHERE (SELECT version FROM gallery WHERE id=1)=?`).bind(JSON.stringify(next), version)
    ]);
    check(guard.meta.changes, 409, "图库或账号已更新，请重试");
    headers.set("X-Gallery-Version", version);
    return send({ success: true });
  } catch (e) {
    if (e.status) return send({ success: false, error: e.message }, e.status);
    if (String(e.message).includes("users.username") && String(e.message).includes("UNIQUE"))
      return send({ success: false, error: "用户名已被使用" }, 409);
    console.error("Gallery API:", e.message);
    return send({ success: false, error: "数据库操作失败" }, 500);
  }
}
