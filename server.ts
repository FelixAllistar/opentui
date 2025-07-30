import { serve } from "bun";
import { existsSync } from "fs";

serve({
  async fetch(request) {
    const url = new URL(request.url);
    let filePath = `.${url.pathname}`;

    // Serve index.html if the path is just the root
    if (filePath === './') {
      filePath = './index.html';
    }

    // Try to serve from the 'dist' directory first for bundled assets
    let file = Bun.file(`./dist${url.pathname}`);
    if (await file.exists()) {
      return new Response(file);
    }

    // Fallback to serving from the root directory
    file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
  port: 3000,
});

console.log("Serving Angry Birds browser test on http://localhost:3000");
console.log("Press Ctrl+C to stop the server.");