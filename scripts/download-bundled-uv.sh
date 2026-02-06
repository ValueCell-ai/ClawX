#!/bin/bash
set -e

# Configuration
UV_VERSION="0.10.0"
BASE_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}"
OUTPUT_DIR="resources/bin"

# Cleanup
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "📦 Preparing to bundle uv v${UV_VERSION}..."

# Function to download and extract
download_and_extract() {
    local platform=$1
    local arch=$2
    local target_dir="$OUTPUT_DIR/$platform-$arch"
    local filename=""
    local url=""
    
    mkdir -p "$target_dir"
    
    # Map to uv release naming convention
    if [ "$platform" == "darwin" ]; then
        if [ "$arch" == "arm64" ]; then
            filename="uv-aarch64-apple-darwin.tar.gz"
        else
            filename="uv-x86_64-apple-darwin.tar.gz"
        fi
    elif [ "$platform" == "win32" ]; then
        filename="uv-x86_64-pc-windows-msvc.zip"
    else
        echo "❌ Unsupported platform: $platform"
        return 1
    fi
    
    url="${BASE_URL}/${filename}"
    echo "⬇️  Downloading for $platform-$arch..."
    curl -L -o "/tmp/$filename" "$url"
    
    echo "📂 Extracting..."
    if [[ "$filename" == *.zip ]]; then
        unzip -q -o "/tmp/$filename" -d "/tmp/uv_extract"
        # Move directly
        if [ -f "/tmp/uv_extract/uv-x86_64-pc-windows-msvc/uv.exe" ]; then
             mv "/tmp/uv_extract/uv-x86_64-pc-windows-msvc/uv.exe" "$target_dir/"
        else 
             # Fallback search
             find "/tmp/uv_extract" -name "uv.exe" -exec mv {} "$target_dir/" \;
        fi
    else
        # Extract properly
        tar -xzf "/tmp/$filename" -C "/tmp"
        
        # The folder name usually matches the archive name without extension
        local folder_name="${filename%.tar.gz}"
        # Some versions might strip the 'v' or change naming, so we rely on find if explicit path fails
        
        if [ -f "/tmp/$folder_name/uv" ]; then
            mv "/tmp/$folder_name/uv" "$target_dir/"
        else
            # Fallback: find any file named 'uv' in /tmp that is executable
            # We must be careful not to find /usr/bin/uv or similar, only in /tmp
            find "/tmp" -maxdepth 2 -type f -name "uv" -exec mv {} "$target_dir/" \;
        fi
    fi
    
    # Permission fix
    if [ "$platform" != "win32" ]; then
        chmod +x "$target_dir/uv"
    fi
    
    # Cleanup tmp
    rm -f "/tmp/$filename"
    rm -rf "/tmp/uv_extract"
    rm -rf "/tmp/uv-*"
    
    echo "✅ Setup complete for $platform-$arch"
}

# Download for Mac (Apple Silicon)
download_and_extract "darwin" "arm64"

# Download for Mac (Intel)
download_and_extract "darwin" "x64"

# Download for Windows (x64)
download_and_extract "win32" "x64"

echo "🎉 All binaries bundled in $OUTPUT_DIR"
