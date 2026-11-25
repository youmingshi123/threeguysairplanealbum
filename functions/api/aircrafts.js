export async function onRequest(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 获取所有数据
  if (request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM aircrafts").all();
    const data = results.map(r => ({ ...r, photos: JSON.parse(r.photos) }));
    return new Response(JSON.stringify(data), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  // 保存/更新数据
  if (request.method === "POST") {
    const data = await request.json();
    await env.DB.prepare("DELETE FROM aircrafts").run();
    
    for (const item of data) {
      await env.DB.prepare(
        "INSERT INTO aircrafts (id, model, reg, airline, livery, photos) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(item.id, item.model, item.reg, item.airline, item.livery, JSON.stringify(item.photos)).run();
    }
    
    return new Response(JSON.stringify({ ok: true }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}
