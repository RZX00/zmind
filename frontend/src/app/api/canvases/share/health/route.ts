import { NextRequest } from "next/server";
import { proxyCanvasRequest } from "../../_proxy";

export async function GET(request: NextRequest) {
  return proxyCanvasRequest(request, "/canvases/share/health");
}
