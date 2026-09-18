// indexer/camera.js

/**
 * Infer camera info for a given root path.
 * Future implementation:
 *  - Sample a handful of video files
 *  - Run ffprobe to inspect metadata
 *  - Look at folder/filename patterns (A001C001_..., B_0008..., etc.)
 */
async function inferCameraForRoot(rootPath) {
  // TODO: implement using ffprobe and pattern matching
  return null;
}

module.exports = {
  inferCameraForRoot
};