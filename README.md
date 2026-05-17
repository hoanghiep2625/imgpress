# ImgPress - Image Compression Service

A high-performance batch image compression service built with Node.js and Sharp. Compress images to multiple formats (WebP, AVIF, PNG, JPEG, GIF) with smart quality optimization and resize capabilities.

## Features

- 🚀 **High-Performance**: Multi-format support with optimized compression algorithms
- 📦 **Batch Processing**: Handle up to 20 files per request (up to 50MB each)
- 🎨 **Multiple Formats**: WebP, AVIF, JPEG, PNG, GIF with auto-detection
- 🔧 **Smart Optimization**: Automatic quality adjustment based on image properties
- 📏 **Resize Support**: Optional width-based resizing with Lanczos3 kernel
- 🌐 **Web UI**: Interactive drag-and-drop interface included
- 🐳 **Docker Ready**: Production-ready Docker multi-stage build
- ⚙️ **Highly Configurable**: Comprehensive environment variables

## Quick Start

### Prerequisites
- Node.js 18+ or Docker

### Installation

```bash
# Clone repository
git clone <repository-url>
cd img-optimize

# Install dependencies
cd server
npm install

# Run server
npm start
```

The server will start on `http://localhost:3000`

### Docker Setup

```bash
# Build image
docker build -t imgpress .

# Run container
docker run -d \
  -p 3000:3000 \
  -e PORT=3000 \
  imgpress
```

## API Documentation

### Compress Single Image

**Endpoint:** `POST /compress/one`

**Request:**
- Content-Type: `multipart/form-data`
- Form field: `file` (required) - Image file to compress

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | `webp` | Output format: `webp`, `avif`, `jpeg`, `png`, `gif`, or `auto` (detect from input) |
| `quality` | number | `80` | Compression quality (1-100). Auto-capped based on format for optimal results |
| `width` | number | `1600` | Max width in pixels. Image won't be enlarged if smaller |

**Response (Success):**
```json
{
  "name": "photo.jpg",
  "mime": "image/webp",
  "originalSize": 2048576,
  "compressedSize": 614400,
  "savedBytes": 1434176,
  "ratio": 70.0,
  "data": "UklGRi4AAABXRUJQVlA4IBoAAAA...",
  "error": false
}
```

**Response (Error):**
```json
{
  "name": "photo.jpg",
  "originalSize": 2048576,
  "error": true,
  "message": "Image too large: 25000×25000px (max 20000px per side)"
}
```

**cURL Example:**
```bash
# Basic compression
curl -X POST \
  -F "file=@image.jpg" \
  http://localhost:3000/compress/one

# Custom format and quality
curl -X POST \
  -F "file=@image.jpg" \
  "http://localhost:3000/compress/one?format=avif&quality=75&width=1200"

# Auto-detect format
curl -X POST \
  -F "file=@image.jpg" \
  "http://localhost:3000/compress/one?format=auto"
```

**JavaScript Example:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('/compress/one?format=webp&quality=80&width=1600', {
  method: 'POST',
  body: formData
});

const result = await response.json();
if (!result.error) {
  // Download or display compressed image
  const imageBuffer = Buffer.from(result.data, 'base64');
  // ... handle image
}
```

## Configuration

Server behavior is controlled via environment variables:

```bash
# Port & Timeouts
PORT=3000
SERVER_TIMEOUT_MS=300000
KEEP_ALIVE_TIMEOUT_MS=360000
HEADERS_TIMEOUT_MS=361000
COMPRESS_TIMEOUT_MS=300000

# Image Size Limits
MAX_IMAGE_SIDE_PX=20000          # Max width/height per side
MAX_IMAGE_MEGAPIXELS=200          # Max total megapixels
MAX_FILE_SIZE_MB=50               # Max file size per upload
MAX_FILES=20                       # Max files per request

# Compression Defaults
DEFAULT_QUALITY=80                # Default quality (1-100)
DEFAULT_WIDTH=1600                # Default resize width
MAX_QUALITY_NO_ALPHA=85           # Max quality for images without alpha
MAX_QUALITY_WITH_ALPHA=90         # Max quality for images with alpha

# Advanced
DITHER_MAX=0.7                    # Dither amount for PNG (max)
DITHER_MIN=0.3                    # Dither amount for PNG (min)
SHARP_CONCURRENCY=0               # 0 = auto, >0 = limit concurrent operations
```

## Performance Notes

### Supported Formats & Optimization

| Format | Best For | Default Quality | Notes |
|--------|----------|-----------------|-------|
| **WebP** | Web delivery | 80 | Modern browsers, excellent quality/size ratio |
| **AVIF** | Maximum compression | 70 | Newest format, slower encoding, best compression |
| **JPEG** | Compatibility | 85 | Universal support, no transparency |
| **PNG** | Lossless/Transparency | 90 | Larger files, preserves quality |
| **GIF** | Animation | 80 | Animated images, limited colors |

### Smart Quality Adjustment

The service automatically caps quality based on image properties:
- Images without alpha channel → capped at `MAX_QUALITY_NO_ALPHA` (85)
- Images with transparency → capped at `MAX_QUALITY_WITH_ALPHA` (90)
- This ensures optimal file size without quality degradation

### Image Processing

- **Resize**: Uses Lanczos3 kernel for high-quality downsampling
- **Color Space**: Converts to sRGB for consistent output
- **Optimization**: 
  - JPEG: MozJPEG + progressive encoding + optimized scanning
  - PNG: Maximum compression + adaptive filtering + dithering
  - AVIF: 4:2:0 chroma subsampling for better compression
  - GIF: Frame analysis + dithering for smooth gradients

## Web UI

Open `http://localhost:3000` in your browser to access the ImgPress web interface with:
- Drag & drop image upload
- Format selection
- Quality control
- Real-time compression stats
- Batch processing

## Development

### Project Structure

```
img-optimize/
├── server/
│   ├── server.js         # Express server & compression logic
│   └── package.json      # Dependencies
├── client/
│   ├── index.html        # Web UI
│   ├── script.js         # Frontend logic
│   └── styles.css        # Styling
├── Dockerfile            # Container configuration
└── README.md             # This file
```

### Local Development

```bash
cd server
npm install
npm start
```

Visit `http://localhost:3000`

## Size Limits

- **Per File**: 50 MB max
- **Per Request**: 20 files max
- **Image Dimensions**: 20,000 px per side max
- **Total Megapixels**: 200 MP max

## Error Handling

Common error messages:

| Error | Cause | Solution |
|-------|-------|----------|
| `file required` | No file in request | Include `file` in form data |
| `Image too large: WxHpx` | Exceeds MAX_IMAGE_SIDE_PX | Request pre-resized image or adjust limit |
| `Image too large: NMP` | Exceeds MAX_IMAGE_MEGAPIXELS | Request lower resolution image |
| `Processing timeout` | Server busy | Reduce quality/disable processing, retry |

## CORS

The API accepts requests from all origins. Customize CORS in `server.js` if needed:

```javascript
res.setHeader('Access-Control-Allow-Origin', '*') // Change '*' to specific domain
```

## License

MIT

## Support

For issues, features, or questions, please open an issue on the repository.
