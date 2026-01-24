import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    resolveAlias: {
      '@mediapipe/face_mesh': './lib/mediapipe-stub.js',
    },
  },
  webpack: (config) => {
    // Handle @mediapipe/face_mesh import issue for webpack fallback
    // Create a mock module since we're using tfjs runtime
    if (!config.resolve) {
      config.resolve = {}
    }
    if (!config.resolve.alias) {
      config.resolve.alias = {}
    }
    config.resolve.alias['@mediapipe/face_mesh'] = path.resolve(__dirname, 'lib/mediapipe-stub.js')
    
    return config
  },
}

export default nextConfig
