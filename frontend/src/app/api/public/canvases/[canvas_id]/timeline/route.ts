import { NextRequest, NextResponse } from 'next/server'
import { requiredServerEnv } from '@/lib/env-utils'

async function proxy(request: NextRequest, path: string) {
  const backend = requiredServerEnv('BACKEND_INTERNAL_URL')
  const url = `${backend}${path}`
  const headers: Record<string, string> = {}
  const cookie = request.headers.get('cookie')
  if (cookie) headers['cookie'] = cookie
  const contentType = request.headers.get('content-type')
  if (contentType) headers['content-type'] = contentType
  const workspaceHeader = request.headers.get('x-workspace-id')
  if (workspaceHeader) headers['x-workspace-id'] = workspaceHeader
  const search = new URL(request.url).search
  const resp = await fetch(`${url}${search}`, { method: 'GET', headers })
  const resHeaders = new Headers()
  const ct = resp.headers.get('content-type')
  if (ct) resHeaders.set('content-type', ct)
  const data = await resp.arrayBuffer()
  return new NextResponse(data, { status: resp.status, headers: resHeaders })
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params
  return proxy(request, `/public/canvases/${canvas_id}/timeline`)
}
