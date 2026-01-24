// Stub module for @mediapipe/face_mesh
// This is only needed when using tfjs runtime, not mediapipe runtime
// The FaceMesh class is not actually used when runtime is set to 'tfjs'

export class FaceMesh {
  constructor(config) {
    // Stub implementation - not used when runtime is 'tfjs'
  }
  
  async close() {
    return Promise.resolve()
  }
  
  onResults(listener) {
    // Stub
  }
  
  async initialize() {
    return Promise.resolve()
  }
  
  reset() {
    // Stub
  }
  
  async send(inputs) {
    return Promise.resolve()
  }
  
  setOptions(options) {
    // Stub
  }
}

// Also export as default for compatibility
export default {
  FaceMesh,
}
