import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-5.5";
const MAX_BODY = 15 * 1024 * 1024;
const attempts = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(body));
}

function allowRequest(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 8) return false;
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("画像サイズが大きすぎます（上限10MB）。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function extractOutput(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return "";
}

async function solve(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allowRequest(ip)) return json(res, 429, { error: "少し時間を置いてから、もう一度試してください。" });
  if (!process.env.OPENAI_API_KEY) {
    return json(res, 503, { error: "OPENAI_API_KEYが未設定です。READMEの手順に沿って設定してください。" });
  }

  try {
    const { image, subject = "auto", note = "" } = await readJson(req);
    if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      return json(res, 400, { error: "JPEG・PNG・WebPの問題画像を選んでください。" });
    }
    if (image.length > 14_000_000) return json(res, 413, { error: "画像は10MB以下にしてください。" });

    const subjectLabel = { math: "数学", physics: "物理", auto: "自動判定" }[subject] || "自動判定";
    const prompt = [
      `科目指定: ${subjectLabel}`,
      note ? `生徒からの補足: ${String(note).slice(0, 500)}` : "補足なし",
      "画像の問題を正確に読み取り、日本の高校生向けに解いてください。",
      "条件や記号が不鮮明なら推測で断定せず、読み取れない箇所を明示してください。",
      "最終答案だけでなく、なぜその式・考え方を使うのかを段階的に説明してください。",
      "計算結果は代入や単位・定義域などで検算してください。",
      "数式は読みやすいプレーンテキストで書いてください。"
    ].join("\n");

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string" },
        problem: { type: "string" },
        answer: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        key_points: { type: "array", items: { type: "string" } },
        check: { type: "string" },
        caution: { type: "string" }
      },
      required: ["subject", "problem", "answer", "steps", "key_points", "check", "caution"]
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions: "あなたは高校数学・高校物理の丁寧な個別指導講師です。正確さを最優先してください。",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: image, detail: "high" }
          ]
        }],
        text: { format: { type: "json_schema", name: "school_solution", strict: true, schema } },
        max_output_tokens: 4000,
        store: false
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || "AIとの通信に失敗しました。";
      console.error("OpenAI API error:", response.status, message);
      return json(res, response.status >= 500 ? 502 : 400, { error: "解説を作れませんでした。画像やAPI設定を確認して、もう一度試してください。" });
    }

    const output = extractOutput(data);
    if (!output) return json(res, 502, { error: "解説を取得できませんでした。もう一度試してください。" });
    json(res, 200, { solution: JSON.parse(output) });
  } catch (error) {
    console.error(error);
    const message = error instanceof SyntaxError ? "送信内容を読み取れませんでした。" : (error.message || "予期しないエラーが発生しました。");
    json(res, 400, { error: message });
  }
}

async function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(root, safe);
  if (!filePath.startsWith(root)) return json(res, 403, { error: "Forbidden" });
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(file);
  } catch {
    json(res, 404, { error: "ページが見つかりません。" });
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/api/health") return json(res, 200, { ok: true, model });
  if (path === "/api/solve" && req.method === "POST") return solve(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
  return serveStatic(req, res);
});

server.listen(port, () => console.log(`SolveLens: http://localhost:${port}`));
