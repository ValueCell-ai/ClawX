
import os
from PIL import Image, ImageChops

def trim_whitespace(im):
    bg = Image.new(im.mode, im.size, im.getpixel((0,0)))
    diff = ImageChops.difference(im, bg)
    diff = ImageChops.add(diff, diff, 2.0, -100)
    bbox = diff.getbbox()
    if bbox:
        return im.crop(bbox)
    return im

def process_image(path):
    try:
        img = Image.open(path)
        img = img.convert("RGBA")
        
        # Simple trim of uniform background
        cropped = trim_whitespace(img)
        
        # If the image is a "photo", simple trim might not work if lighting is uneven.
        # But let's assume digital image for now based on typical user behavior.
        # Function to find the QR code area more robustly:
        # Convert to grayscale, threshold, invert, find bbox of black pixels.
        gray = img.convert("L")
        # Threshold: anything darker than 200 is "black" (QR code), else white
        bw = gray.point(lambda x: 0 if x < 200 else 255, '1')
        # Invert to make QR code white on black background for getbbox
        bw_inv = ImageChops.invert(bw)
        bbox = bw_inv.getbbox()
        
        if bbox:
            # Add a small padding
            left, upper, right, lower = bbox
            width, height = img.size
            left = max(0, left - padding)
            upper = max(0, upper - padding)
            right = min(width, right + padding)
            lower = min(height, lower + padding)
            cropped = img.crop((left, upper, right, lower))
        
        cropped.save(path)
        print(f"Processed {path}")
    except Exception as e:
        print(f"Error processing {path}: {e}")

assets_dir = "src/assets/community"
for filename in ["feishu-qr.png", "wecom-qr.png"]:
    file_path = os.path.join(assets_dir, filename)
    if os.path.exists(file_path):
        process_image(file_path)
    else:
        print(f"File not found: {file_path}")
