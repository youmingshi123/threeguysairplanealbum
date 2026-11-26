const MAX_FILE_BYTES = 19 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function reply(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    // 与飞机图库现有登录接口使用同一套会话。
    const auth = request.headers.get("Authorization") || "";
    const match = /^Bearer ([0-9a-f]{64})$/.exec(auth);
    if (!match) return reply({ error: "请先登录飞机图库" }, 401);

    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(match[1])
    );
    const tokenHash = Array.from(
      new Uint8Array(hash),
      byte => byte.toString(16).padStart(2, "0")
    ).join("");

    const session = await env.DB.prepare(
      "SELECT username FROM sessions WHERE token = ? AND expires > unixepoch()"
    ).bind(tokenHash).first();

    if (!session) {
      return reply({ error: "登录已过期，请重新登录" }, 401);
    }
    if (!env.IMG_ORIGIN || !env.IMGBED_TOKEN) {
      return reply({ error: "请检查 IMG_ORIGIN 和 IMGBED_TOKEN 配置" }, 503);
    }

    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_FILE_BYTES + 65536) {
      return reply({ error: "单张照片上限为 19 MiB" }, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return reply({ error: "上传表单格式错误" }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File) || !IMAGE_TYPES.has(file.type)) {
      return reply({ error: "请选择 JPG、PNG 或 WebP 图片" }, 400);
    }
    if (!file.size || file.size > MAX_FILE_BYTES) {
      return reply({ error: "图片为空或超过 19 MiB" }, 413);
    }

    const origin = new URL(env.IMG_ORIGIN).origin;
    const target = new URL("/upload", origin);
    target.searchParams.set("uploadChannel", "huggingface");

    const outgoing = new FormData();
    outgoing.append("file", file, file.name);

    const upstream = await fetch(target, {
      method: "POST",
      headers: { Authorization: "Bearer " + env.IMGBED_TOKEN },
      body: outgoing,
      redirect: "error"
    });

    if (!upstream.ok) {
      return reply({ error: `图床上传失败（${upstream.status}）` }, 502);
    }

    const result = await upstream.json();
    const src = result?.[0]?.src;
    if (typeof src !== "string" || !src) {
      return reply({ error: "图床没有返回照片地址" }, 502);
    }

    const image = new URL(src, origin);
    if (image.origin !== origin || !image.pathname.startsWith("/file/")) {
      return reply({ error: "图床返回的地址与配置不符" }, 502);
    }

    return reply({ url: image.href });
  } catch {
    return reply({ error: "上传未完成，请检查图床地址、D1 绑定和网络" }, 502);
  }
}
