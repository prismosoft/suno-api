import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const token = process.env.API_BEARER_TOKEN;

  if (!token) {
    return NextResponse.json({ error: 'API_BEARER_TOKEN is not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const providedToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (providedToken !== token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/v1/:path*'],
};