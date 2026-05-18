var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_octokit = require("octokit");
var import_fs = __toESM(require("fs"), 1);
import_dotenv.default.config();
var defaultAiClient = null;
function getAI(userKey) {
  const key = userKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || key === "MY_GEMINI_API_KEY" || key.trim() === "") {
    throw new Error("GEMINI_API_KEY missing. Please set your API key in project settings or in the UI.");
  }
  if (!userKey && defaultAiClient) return defaultAiClient;
  const client = new import_genai.GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
  if (!userKey) defaultAiClient = client;
  return client;
}
async function startServer() {
  console.log("Starting server engine...");
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());
  app.use((req, res, next) => {
    const userKey = req.headers["x-gemini-api-key"];
    if (userKey && typeof userKey === "string" && userKey.trim() !== "") {
      req.userAiKey = userKey;
    }
    next();
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });
  app.post("/api/auth/gemini/validate", async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "No key provided" });
    try {
      const genAI = new import_genai.GoogleGenAI({ apiKey: key });
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      await model.generateContent({ contents: [{ role: "user", parts: [{ text: "ping" }] }] });
      res.json({ valid: true });
    } catch (error) {
      console.error("Gemini Validation Error:", error);
      res.status(401).json({ valid: false, error: error.message });
    }
  });
  app.get("/api/auth/github/url", (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      console.error("GITHUB_CLIENT_ID missing in environment");
      return res.status(500).json({ error: "GITHUB_CLIENT_ID not configured. Please add it to project settings." });
    }
    const appId = process.env.APP_URL;
    let origin;
    if (appId) {
      origin = appId.replace(/\/$/, "");
    } else {
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.get("host");
      origin = `${protocol}://${host}`;
    }
    if (origin.includes(":3000") && origin.startsWith("https")) {
      origin = origin.replace(":3000", "");
    }
    const redirectUri = `${origin}/api/auth/github/callback`;
    console.log("[GitHub Auth] Generated redirect_uri:", redirectUri);
    console.log("[GitHub Auth] Client ID present:", !!clientId);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "public_repo",
      state: Math.random().toString(36).substring(7)
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  });
  app.get(["/api/auth/github/callback", "/api/auth/github/callback/"], async (req, res) => {
    const { code } = req.query;
    console.log("GitHub callback received with code:", code ? "YES" : "NO");
    if (!code) return res.status(400).send("No code provided from GitHub");
    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error("GitHub credentials missing in server environment");
      }
      const appId = process.env.APP_URL;
      let origin;
      if (appId) {
        origin = appId.replace(/\/$/, "");
      } else {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers["x-forwarded-host"] || req.get("host");
        origin = `${protocol}://${host}`;
      }
      if (origin.includes(":3000") && origin.startsWith("https")) {
        origin = origin.replace(":3000", "");
      }
      const redirectUri = `${origin}/api/auth/github/callback`;
      console.log("[GitHub Callback] Using redirect_uri:", redirectUri);
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri
        })
      });
      const data = await response.json();
      if (data.error) {
        console.error("GitHub Token Exchange Error:", data.error, data.error_description);
        throw new Error(data.error_description || data.error);
      }
      if (!data.access_token) {
        throw new Error("GitHub did not return an access token");
      }
      res.send(`
        <html>
          <body style="background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; margin: 0;">
            <div style="text-align: center; padding: 20px;">
              <h2 style="color: #4ade80; margin-bottom: 10px;">Auth Successful!</h2>
              <p style="color: #94a3b8;">Closing window...</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: '${data.access_token}' }, '*');
                  setTimeout(() => window.close(), 600);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Auth callback process error:", error);
      res.status(500).send(`Authentication failed: ${error.message}`);
    }
  });
  app.post("/api/github/deploy", async (req, res) => {
    const { token, code, title, description } = req.body;
    if (!token || !code || !title) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const octokit = new import_octokit.Octokit({ auth: token });
    try {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      const baseRepoName = title.toLowerCase().replace(/[^a-z0-9]/g, "-");
      const repoName = `ai-site-${baseRepoName}-${Math.random().toString(36).substring(7)}`;
      const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        description: description || "Generated by AI Site Crafter",
        auto_init: true
      });
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: user.login,
        repo: repoName,
        path: "index.html",
        message: "Initial commit with generated code",
        content: Buffer.from(code).toString("base64")
      });
      try {
        await octokit.rest.repos.createPagesSite({
          owner: user.login,
          repo: repoName,
          source: {
            branch: "main",
            path: "/"
          }
        });
      } catch (pagesError) {
        console.warn("Failed to enable GitHub Pages:", pagesError);
      }
      const repoUrl = repo.html_url;
      const pagesUrl = `https://${user.login}.github.io/${repoName}/`;
      res.json({ repoUrl, pagesUrl });
    } catch (error) {
      console.error("GitHub Deployment Error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  const handleGenAiError = (error, res) => {
    console.error("Gemini Error:", error);
    const errorStr = JSON.stringify(error).toLowerCase();
    const isQuotaError = error.message?.includes("429") || error.status === 429 || error.message?.includes("quota") || errorStr.includes("resource_exhausted") || errorStr.includes("quota exceeded") || errorStr.includes("429");
    const isAuthError = error.message?.includes("403") || error.status === 403 || errorStr.includes("permission_denied") || errorStr.includes("insufficient authentication scopes") || errorStr.includes("unregistered callers");
    if (isAuthError) {
      return res.status(403).json({
        error: "Erro de Autentica\xE7\xE3o com o Gemini. Verifique se sua API Key \xE9 v\xE1lida e tem as permiss\xF5es corretas.",
        details: error.message,
        type: "AUTH_ERROR"
      });
    }
    res.status(isQuotaError ? 429 : 500).json({
      error: isQuotaError ? "Voc\xEA atingiu o limite de 20 requisi\xE7\xF5es di\xE1rias (plano gratuito Google Gemini). O limite ser\xE1 resetado em 24h." : "A gera\xE7\xE3o falhou. Verifique sua conex\xE3o ou tente novamente mais tarde.",
      details: error.message,
      type: isQuotaError ? "QUOTA_EXCEEDED" : "GENERAL_ERROR"
    });
  };
  app.post("/api/generate-options", async (req, res) => {
    const { prompt } = req.body;
    try {
      const response = await getAI(req.userAiKey).models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `The user wants to builder a website for: "${prompt}". 
        Suggest 3 distinct layout options. For each option, provide:
        - title: a short name for the layout style (bold names like "NEO-DUSK", "IVORY FLOW", "CYBER-GRID").
        - description: a short 1-sentence description.
        - features: a list of 3 key features.
        - vibe: a string describing the visual style.
        - previewHtml: A COMPLETE, FULL-PAGE, HIGH-FIDELITY HTML document. 
          The HTML MUST be a complete document starting with <!DOCTYPE html>.
          In the <head>, you MUST explicitly include: <script src="https://cdn.tailwindcss.com"></script>
          It MUST NOT have JavaScript.
          It MUST include a professional Navigation bar, a large Hero Section with persuasive headlines, a Features Section, and a Footer.
          The visual style MUST strictly follow the 'vibe'.
          The layout MUST be responsive and use high-quality Tailwind classes.
          The code MUST be well-indented and easy to read.
          Include a <style> block for custom fonts (Inter) if needed.`,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.ARRAY,
            items: {
              type: import_genai.Type.OBJECT,
              properties: {
                title: { type: import_genai.Type.STRING },
                description: { type: import_genai.Type.STRING },
                features: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.STRING } },
                vibe: { type: import_genai.Type.STRING },
                previewHtml: { type: import_genai.Type.STRING }
              },
              required: ["title", "description", "features", "vibe", "previewHtml"]
            }
          }
        }
      });
      res.json(JSON.parse(response.text));
    } catch (error) {
      handleGenAiError(error, res);
    }
  });
  app.post("/api/pre-generate", async (req, res) => {
    const { prompt } = req.body;
    try {
      const systemPrompt = `You are an expert web developer.
      The user wants a website for: "${prompt}".
      Start generating the CORE structure, content, and high-quality sections (hero, features, about, contact, etc.) using Tailwind CSS and HTML.
      Use professional copy related to the prompt.
      Return a COMPLETE standalone HTML document including <!DOCTYPE html>, <html>, <head> with <script src="https://cdn.tailwindcss.com"></script>, and <body>.
      The code MUST be beautifully indented with 2 spaces.
      Return ONLY the code in the "html" field of a JSON object.`;
      const response = await getAI(req.userAiKey).models.generateContent({
        model: "gemini-3-flash-preview",
        contents: systemPrompt,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              html: { type: import_genai.Type.STRING }
            },
            required: ["html"]
          }
        }
      });
      res.json(JSON.parse(response.text));
    } catch (error) {
      handleGenAiError(error, res);
    }
  });
  app.post("/api/finalize-generation", async (req, res) => {
    const { code, option } = req.body;
    try {
      const systemPrompt = `Update the following HTML code to strictly follow this brand style/vibe: "${option.title} - ${option.vibe}".
      Current Code: ${code}
      
      Requirements:
      - Apply the visual aesthetic (colors, gradients, typography, spacing) described in the vibe.
      - Keep all existing sections and content.
      - Ensure the result is a complete, valid, standalone HTML document (<!DOCTYPE html>, Head with Tailwind Script, Body).
      - The code MUST be beautifully indented with 2 spaces.
      - Return ONLY the code in the "html" field of a JSON object.`;
      const response = await getAI(req.userAiKey).models.generateContent({
        model: "gemini-3-flash-preview",
        contents: systemPrompt,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              html: { type: import_genai.Type.STRING }
            },
            required: ["html"]
          }
        }
      });
      res.json(JSON.parse(response.text));
    } catch (error) {
      handleGenAiError(error, res);
    }
  });
  app.post("/api/generate-code", async (req, res) => {
    const { prompt, option } = req.body;
    try {
      const systemPrompt = `You are an expert web developer.
      Generate a single-file solution (HTML with internal CSS and JS) based on the user's request.
      Request: "${prompt}"
      Chosen Style: ${option.title} (${option.vibe})
      
      Requirements:
      - Use ONLY standard HTML5, Tailwind CSS (via CDN), and Vanilla JavaScript.
      - Make it responsive and modern.
      - Include placeholder images using Unsplash (e.g. https://images.unsplash.com/photo-...).
      - The code MUST be a complete, valid HTML document, beautifully indented with 2 spaces.
      - Return ONLY the code in the "html" field of a JSON object.`;
      const response = await getAI(req.userAiKey).models.generateContent({
        model: "gemini-3-flash-preview",
        contents: systemPrompt,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              html: { type: import_genai.Type.STRING }
            },
            required: ["html"]
          }
        }
      });
      res.json(JSON.parse(response.text));
    } catch (error) {
      handleGenAiError(error, res);
    }
  });
  app.post("/api/refine", async (req, res) => {
    const { prompt, currentCode, history } = req.body;
    try {
      const response = await getAI(req.userAiKey).models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { text: `Current Code: ${currentCode}` },
          ...history.map((m) => ({ text: `${m.role}: ${m.content}` })),
          { text: `User request: ${prompt}. Update the code accordingly. Ensure the resulting HTML is beautifully indented with 2 spaces. Return both the new code and a short explanation of what you changed.` }
        ],
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              html: { type: import_genai.Type.STRING },
              explanation: { type: import_genai.Type.STRING }
            },
            required: ["html", "explanation"]
          }
        }
      });
      res.json(JSON.parse(response.text));
    } catch (error) {
      handleGenAiError(error, res);
    }
  });
  app.get("/api/download-dist", async (req, res) => {
    const distPath = import_path.default.join(process.cwd(), "dist");
    if (!import_fs.default.existsSync(distPath)) {
      return res.status(404).json({ error: "A pasta 'dist' n\xE3o existe. Voc\xEA precisa gerar o build primeiro." });
    }
    try {
      const archiver = (await import("archiver")).default;
      const archive = archiver("zip", { zlib: { level: 9 } });
      res.attachment("projeto-dist.zip");
      archive.on("error", (err) => {
        console.error("Archive error:", err);
        if (!res.headersSent) {
          res.status(500).send({ error: err.message });
        }
      });
      archive.pipe(res);
      archive.directory(distPath, false);
      await archive.finalize();
    } catch (err) {
      console.error("Failed to create ZIP:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Erro ao gerar o arquivo ZIP. Verifique se o pacote 'archiver' est\xE1 instalado corretamente." });
      }
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
//# sourceMappingURL=server.cjs.map
