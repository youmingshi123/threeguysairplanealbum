const limit = 19 * 1024 * 1024;
const types = new Set(["image/jpeg", "image/png", "image/webp"]);
const reply = (data, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  let step = "检查图库会话";
  try {
    const token = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("Authorization") || "");
    if (!token) return reply({error: "请先登录飞机图库"}, 401);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token[1]));
    const key = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    if (!env.DB) return reply({error: "当前部署缺少 DB 绑定"}, 503);
    const session = await env.DB.prepare("SELECT username FROM sessions WHERE token=? AND expires > unixepoch()").bind(key).first();
    if (!session) return reply({error: "请重新登录图库"}, 401);

    step = "读取图床配置";
    const secret = env.IMGBED_TOKEN?.trim();
    if (!env.IMG_ORIGIN || !secret) return reply({error: "请检查 IMG_ORIGIN 和 IMGBED_TOKEN"}, 503);
    if (/^(?:Bearer\s|hf_)/i.test(secret)) return reply({error: "IMGBED_TOKEN 请填写图床生成的原始上传 Token"}, 503);
    const origin = new URL(env.IMG_ORIGIN.trim());
    if (origin.protocol !== "https:" || origin.href !== origin.origin + "/")
      return reply({error: "IMG_ORIGIN 应为 HTTPS 图床首页地址"}, 503);

    step = "读取照片";
    if (Number(request.headers.get("Content-Length")) > limit + 65536)
      return reply({error: "单张上限为 19 MiB"}, 413);
    const file = (await request.formData()).get("file");
    if (!file || !types.has(file.type) || !file.size) return reply({error: "请选择 JPG、PNG 或 WebP 图片"}, 400);
    if (file.size > limit) return reply({error: "单张上限为 19 MiB"}, 413);
    const form = new FormData();
    form.append("file", file, file.name || "photo");
    step = "连接图床";
    const response = await fetch(new URL("/upload?uploadChannel=huggingface", origin), {
      method: "POST", headers: {Authorization: "Bearer " + secret}, body: form, redirect: "manual"
    });
    if (!response.ok) return reply({error: "图床接口返回 HTTP " + response.status}, 502);
    step = "解析图床响应";
    const data = await response.json();
    const src = Array.isArray(data) ? data[0]?.src : data?.src;
    if (!src || typeof src !== "string") return reply({error: "图床未返回 src"}, 502);
    const photo = new URL(src, origin);
    if (photo.origin !== origin.origin || !photo.pathname.startsWith("/file/") || photo.username || photo.password)
      return reply({error: "图床返回了意外的照片地址"}, 502);
    return reply({url: photo.href});
  } catch {
    return reply({error: "上传失败，出错步骤：" + step}, 502);
  }
}
