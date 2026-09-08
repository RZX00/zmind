import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { requiredOneOf } from '@/lib/env-utils'

// Route-handler specific implementation that ensures Set-Cookie is attached
// to the same response we return to the browser. This avoids environments
// where writing cookies via next/headers may be ignored.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('returnUrl') ?? '/'

  // Use configured URL instead of parsed origin to avoid 0.0.0.0 issues
  const baseUrl = requiredOneOf(['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_URL'])

  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error) {
    console.error('❌ Auth callback error:', error, errorDescription)
    return NextResponse.redirect(`${baseUrl}/auth?error=${encodeURIComponent(error)}`)
  }

  if (code) {
    try {
      // Prepare a redirect response we will enrich with Set-Cookie values
      const response = NextResponse.redirect(`${baseUrl}${next}`)

      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll()
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) => {
                try {
                  response.cookies.set(name, value, options)
                } catch (e) {
                  console.error('❌ Failed setting auth cookie on response:', e)
                }
              })
            },
          },
        }
      )

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeError) {
        console.error('❌ Error exchanging code for session:', exchangeError)
        return NextResponse.redirect(
          `${baseUrl}/auth?error=${encodeURIComponent(exchangeError.message)}`
        )
      }

      // On success, return the redirect that already contains Set-Cookie
      return response
    } catch (err) {
      console.error('❌ Unexpected error in auth callback:', err)
      return NextResponse.redirect(`${baseUrl}/auth?error=unexpected_error`)
    }
  }

  return NextResponse.redirect(`${baseUrl}/auth`)
}
