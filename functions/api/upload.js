const MAX_FILE_BYTES = 19 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function reply(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function onRequestPost({ request, env }) {
  let step = "检查图库登录";

  try {
    // 1. 验证飞机图库的登录会话。
    const authorization = request.headers.get("Authorization") || "";
    const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization);

    if (!match) {
      return reply({ error: "请先登录飞机图库" }, 401);
    }

    step = "查询 D1 的 sessions 表";

    if (!env.DB || typeof env.DB.prepare !== "function") {
      return reply({ error: "飞机图库缺少名为 DB 的 D1 绑定" }, 503);
    }

    const session = await env.DB.prepare(`
      SELECT username
      FROM sessions
      WHERE token = ? AND expires > unixepoch()
    `).bind(await hashToken(match[1])).first();

    if (!session) {
      return reply({ error: "登录已过期，请退出图库后重新登录" }, 401);
    }

    // 2. 读取 Cloudflare 给当前部署提供的图床配置。
    step = "读取图床配置";

    const originSetting = (env.IMG_ORIGIN || "").trim();
    const imgbedToken = (env.IMGBED_TOKEN || "").trim();

    if (!originSetting) {
      return reply({ error: "当前部署缺少变量 IMG_ORIGIN" }, 503);
    }
    if (!imgbedToken) {
      return reply({ error: "当前部署缺少密钥 IMGBED_TOKEN" }, 503);
    }
    if (/^Bearer\s/i.test(imgbedToken)) {
      return reply({
        error: "IMGBED_TOKEN 只需填写原始密钥，请去掉开头的 Bearer 和空格"
      }, 503);
    }
    if (imgbedToken.startsWith("hf_")) {
      return reply({
        error: "IMGBED_TOKEN 填成了 Hugging Face 密钥，请改填 ImgBed 的上传 Token"
      }, 503);
    }

    let imgbed;
    try {
      imgbed = new URL(originSetting);
    } catch {
      return reply({
        error: "IMG_ORIGIN 格式错误，请填写完整地址，例如 https://cloudflare-imgbed-83e.pages.dev"
      }, 503);
    }

    if (
      imgbed.protocol !== "https:" ||
      imgbed.username ||
      imgbed.password ||
      imgbed.pathname !== "/" ||
      imgbed.search ||
      imgbed.hash
    ) {
      return reply({
        error: "IMG_ORIGIN 请只填写 HTTPS 图床首页地址，末尾可以有一个斜杠"
      }, 503);
    }

    // 3. 读取浏览器提交的照片。
    step = "读取上传表单";

    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_FILE_BYTES + 65536) {
      return reply({ error: "单张图片最大支持 19 MiB" }, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return reply({ error: "无法读取图片表单，请重新选择照片后上传" }, 400);
    }

    const file = form.get("file");

    // 直接检查上传对象的属性，避免依赖运行环境中的全局 File 构造函数。
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return reply({ error: "上传表单中没有名为 file 的图片文件" }, 400);
    }
    if (!IMAGE_TYPES.has(file.type)) {
      return reply({ error: "请选择 JPG、PNG 或 WebP 图片" }, 415);
    }
    if (file.size === 0) {
      return reply({ error: "照片文件为空，请重新选择" }, 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return reply({ error: "单张图片最大支持 19 MiB" }, 413);
    }

    // 4. 从服务器向 ImgBed 上传，密钥只在服务器端使用。
    step = "准备图床上传请求";

    const target = new URL("/upload", imgbed.origin);
    target.searchParams.set("uploadChannel", "huggingface");

    const outgoing = new FormData();
    outgoing.append("file", file, file.name || "photo");

    step = "连接图床上传接口";

    const upstream = await fetch(target.href, {
      method: "POST",
      headers: { Authorization: "Bearer " + imgbedToken },
      body: outgoing,
      redirect: "manual"
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      return reply({
        error: `图床上传接口发生重定向（HTTP ${upstream.status}），请检查图床域名和访问设置`
      }, 502);
    }

    if (upstream.status === 401 || upstream.status === 403) {
      return reply({
        error: `图床拒绝上传（HTTP ${upstream.status}），请检查 ImgBed Token 的 upload 权限及图床访问设置`
      }, 502);
    }

    if (!upstream.ok) {
      return reply({
        error: `图床上传接口返回 HTTP ${upstream.status}，请在图床首页用 Hugging Face 渠道测试同一张照片`
      }, 502);
    }

    // 5. 解析 ImgBed 返回的 [{ src: "/file/..." }]。
    step = "读取图床响应";

    let result;
    try {
      result = await upstream.json();
    } catch {
      const type = upstream.headers.get("Content-Type") || "未知类型";
      return reply({
        error: `图床返回 HTTP ${upstream.status}，但响应无法解析为 JSON（${type}）`
      }, 502);
    }

    const src = Array.isArray(result) ? result[0]?.src : result?.src;
    if (typeof src !== "string" || !src.trim()) {
      return reply({ error: "图床响应里缺少照片地址 src" }, 502);
    }

    step = "校验图床返回的照片地址";

    const image = new URL(src, imgbed.origin);
    if (
      image.origin !== imgbed.origin ||
      image.username ||
      image.password ||
      !image.pathname.startsWith("/file/")
    ) {
      return reply({ error: "图床返回的照片地址与 IMG_ORIGIN 或 /file/ 路径不符" }, 502);
    }

    return reply({ url: image.href });
  } catch (error) {
    // 浏览器只显示失败步骤，密钥和请求头不会写入日志。
    console.error("Gallery upload failed", {
      step,
      errorType: error instanceof Error ? error.name : "UnknownError"
    });

    return reply({ error: "上传失败，出错步骤：" + step }, 502);
  }
}
