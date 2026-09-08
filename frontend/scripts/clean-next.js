const fs = require('fs');
const path = require('path');

// Remove the entire .next directory to avoid stale Turbopack/webpack artifacts
const nextDir = path.join(__dirname, '..', '.next');

try {
  // First try to remove all files recursively
  if (fs.existsSync(nextDir)) {
    const removeRecursive = (dirPath) => {
      if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
          const curPath = path.join(dirPath, file);
          if (fs.lstatSync(curPath).isDirectory()) {
            removeRecursive(curPath);
          } else {
            fs.unlinkSync(curPath);
          }
        });
        fs.rmdirSync(dirPath);
      }
    };
    removeRecursive(nextDir);
    console.log('Removed stale .next directory before build.');
  }
} catch (error) {
  if (error && error.code !== 'ENOENT') {
    console.warn('Warning: Could not fully remove .next directory:', error.message);
    // Don't throw error, just continue with build
  }
}

