import type { HonoRequest } from "hono";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "3600",
};

const requiredHeaders: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0 (Edition std-2)",
  "Accept": "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language":
    "en-US,en;q=0.9,ja;q=0.8,fr;q=0.7,zh-CN;q=0.6,zh;q=0.5,es;q=0.4,nl;q=0.3,pl;q=0.2,vi;q=0.1,zh-TW;q=0.1",
  "Origin": "https://megacloud.blog",
  "Referer": "https://megacloud.blog/",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Sec-CH-UA-Platform": "\"Windows\"",
  "Sec-CH-UA":
    "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Opera GX\";v=\"124\"",
  "Sec-CH-UA-Mobile": "?0",
};

export async function RequestHandler({ response }: { response: HonoRequest }) {
  try {
    const { url } = response.query();

    if (!url) {
      return new Response(JSON.stringify({ error: "No URL provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const headers = { ...requiredHeaders };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const fetchOptions: RequestInit = {
      headers,
      redirect: "follow",
      signal: controller.signal,
      method: "GET",
    };

    const fetchedResponse = await fetch(url, fetchOptions).finally(() =>
      clearTimeout(timeoutId)
    );

    if (fetchedResponse.status === 403) {
      return new Response(
        JSON.stringify({
          message: "Access denied by target server",
          error: "The streaming server returned a 403 Forbidden error",
          headers,
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    let type = fetchedResponse.headers.get("Content-Type") || "text/plain";
    let responseBody: ArrayBuffer | string | null = null;

    if (type.includes("text/vtt")) {
      responseBody = (await fetchedResponse.text()) as string;

      const regex = /.+?\.(jpg)+/g;
      const matches = [...responseBody.matchAll(regex)];

      const fileNames: string[] = [];

      for (const match of matches) {
        const filename = match[0];
        if (!fileNames.includes(filename)) {
          fileNames.push(filename);
        }
      }

      if (fileNames.length > 0) {
        for (const filename of fileNames) {
          const newUrl = url.replace(/\/[^\/]*$/, `/${filename}`);

          responseBody = responseBody.replaceAll(
            filename,
            "/fetch?url=" + encodeURIComponent(newUrl)
          );
        }
      }
    } else if (
      type.includes("application/vnd.apple.mpegurl") ||
      type.includes("application/x-mpegurl") ||
      type.includes("video/MP2T") ||
      type.includes("audio/mpegurl") ||
      type.includes("application/x-mpegURL") ||
      type.includes("audio/x-mpegurl") ||
      (type.includes("text/html") &&
        (url.endsWith(".m3u8") || url.endsWith(".ts")))
    ) {
      responseBody = (await fetchedResponse.text()) as string;

      if (!responseBody.startsWith("#EXTM3U")) {
        return new Response(responseBody, {
          headers: corsHeaders,
          status: fetchedResponse.status,
          statusText: fetchedResponse.statusText,
        });
      }

      const regex = /\/[^\/]*$/;
      const urlRegex =
        /^(?:(?:(?:https?|ftp):)?\/\/)[^\s/$.?#].[^\s]*$/i;
      const m3u8FileChunks = responseBody.split("\n");
      const m3u8AdjustedChunks: string[] = [];

      for (const line of m3u8FileChunks) {
        if (line.startsWith("#") || !line.trim()) {
          m3u8AdjustedChunks.push(line);
          continue;
        }

        let formattedLine = line;
        if (line.startsWith(".")) {
          formattedLine = line.substring(1);
        }

        if (formattedLine.match(urlRegex)) {
          m3u8AdjustedChunks.push(
            `/fetch?url=${encodeURIComponent(formattedLine)}`
          );
        } else {
          const newUrls = url.replace(
            regex,
            formattedLine.startsWith("/")
              ? formattedLine
              : `/${formattedLine}`
          );

          m3u8AdjustedChunks.push(
            `/fetch?url=${encodeURIComponent(newUrls)}`
          );
        }
      }

      responseBody = m3u8AdjustedChunks.join("\n");
    } else {
      responseBody = await fetchedResponse.arrayBuffer();
    }

    if (responseBody instanceof ArrayBuffer) {
      const body = new Uint8Array(responseBody);
      if (body.length > 0 && body[0] === 0x47) {
        type = "video/mp2t";
      }
    }

    const responseHeaders = { ...corsHeaders, "Content-Type": type };

    return new Response(responseBody as BodyInit, {
      headers: responseHeaders,
      status: fetchedResponse.status,
      statusText: fetchedResponse.statusText,
    });
  } catch (error: any) {
    let errorMessage = error.message;
    let statusCode = 500;

    if (error.name === "AbortError") {
      errorMessage = "Request timed out";
      statusCode = 504;
    } else if (error.name === "TypeError" && error.message.includes("fetch")) {
      errorMessage = "Network error when trying to fetch resource";
      statusCode = 502;
    }

    return new Response(
      JSON.stringify({
        message: "Request failed",
        error: errorMessage,
        url: response.query().url,
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
}
