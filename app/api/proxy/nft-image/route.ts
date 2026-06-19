import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

// Proxy endpoint to fetch NFT images and avoid CORS issues
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const imageUrl = searchParams.get('url')

    if (!imageUrl) {
      return NextResponse.json({ error: 'URL parameter required' }, { status: 400 })
    }

    // Validate URL format
    let url
    try {
      url = new URL(imageUrl)
    } catch (e) {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }

    // Block localhost/private IPs for security (unless in development)
    const isDevelopment = process.env.NODE_ENV === 'development'
    if (!isDevelopment && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.startsWith('192.168.') || url.hostname.startsWith('10.'))) {
      return NextResponse.json({ error: 'Private IPs not allowed' }, { status: 403 })
    }

    console.log('🎁 [PROXY] Fetching image:', imageUrl)

    // Fetch the image
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*, video/*',
      },
    })

    if (!response.ok) {
      console.log('🎁 [PROXY] Failed:', response.status)
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: response.status })
    }

    // Get the image data
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let finalBuffer = buffer
    // Detect content type from URL extension or response header
    let contentType = response.headers.get('content-type') || 'image/jpeg'
    if (imageUrl.endsWith('.webp')) contentType = 'image/webp'
    else if (imageUrl.endsWith('.gif')) contentType = 'image/gif'
    else if (imageUrl.endsWith('.png')) contentType = 'image/png'
    else if (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg')) contentType = 'image/jpeg'

    // Handle TGS (Gzipped Lottie JSON)
    if (imageUrl.endsWith('.tgs')) {
      try {
        const { gunzipSync } = await import('zlib')
        finalBuffer = gunzipSync(buffer)
        contentType = 'application/json'
        console.log('🎁 [PROXY] Decompressed TGS file')
      } catch (error) {
        console.error('🎁 [PROXY] Failed to decompress TGS:', error)
        // Return original buffer if decompression fails
      }
    }

    console.log('🎁 [PROXY] Success:', contentType, finalBuffer.length, 'bytes')

    // Return the image with proper headers
    // Cache for 1 year (365 days = 31536000 seconds)
    return new NextResponse(finalBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    console.error('🎁 [PROXY] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
