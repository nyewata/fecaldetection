from ultralytics import RTDETR, YOLO
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# -----------------------------
# Config
# -----------------------------
MODEL_PATH = "models/best.pt"
IMAGE_PATH = "test/helminths-112.jpg"
OUTPUT_DIR = "offline_test_output"
OUTPUT_NAME = "helminths-112-annotated.jpg"

CONF = 0.25
IMGSZ = 640
MODEL_TYPE = "rtdetr"   # "rtdetr" or "yolo"

BOX_COLOR = "yellow"
TEXT_COLOR = "black"
TEXT_BG_COLOR = "yellow"
LINE_WIDTH = 2
FONT_SIZE = 13


def load_model(model_path: str, model_type: str):
    if model_type.lower() == "rtdetr":
        return RTDETR(model_path)
    elif model_type.lower() == "yolo":
        return YOLO(model_path)
    else:
        raise ValueError("MODEL_TYPE must be 'rtdetr' or 'yolo'")


def load_font(font_size: int):
    # Tries a few common fonts, then falls back
    candidates = [
        "fonts/Arial.ttf"
    ]

    for path in candidates:
        try:
            return ImageFont.truetype(path, font_size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_detections(img: Image.Image, results, model):
    draw = ImageDraw.Draw(img)
    font = load_font(FONT_SIZE)

    class_colors = {
        0: ("yellow", "black"),
        1: ("red", "white"),
        2: ("lime", "black"),
        3: ("cyan", "black"),
        4: ("orange", "black"),
        5: ("magenta", "white"),
        6: ("blue", "white"),
        7: ("purple", "white"),
        8: ("gold", "black"),
        9: ("deeppink", "white"),
        10: ("white", "black"),
    }

    default_box_color = "yellow"
    default_text_color = "black"

    for result in results:
        print(f"\nImage: {result.path}")

        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            print("No detections found.")
            continue

        for i in range(len(boxes)):
            cls_id = int(boxes.cls[i].item())
            conf = float(boxes.conf[i].item())
            x1, y1, x2, y2 = boxes.xyxy[i].tolist()

            class_name = model.names.get(cls_id, str(cls_id)) if hasattr(model, "names") else str(cls_id)
            label = f"{class_name} {conf:.2f}"

            box_color, text_color = class_colors.get(
                cls_id,
                (default_box_color, default_text_color)
            )

            print(
                f"Detection {i + 1}: "
                f"class={class_name} "
                f"class_id={cls_id} "
                f"conf={conf:.4f} "
                f"box={[round(v, 2) for v in [x1, y1, x2, y2]]}"
            )

            draw.rectangle([x1, y1, x2, y2], outline=box_color, width=LINE_WIDTH)

            text_bbox = draw.textbbox((0, 0), label, font=font)
            text_w = text_bbox[2] - text_bbox[0]
            text_h = text_bbox[3] - text_bbox[1]

            pad = 2
            text_x = x1
            text_y = y1 - text_h - 2 * pad - 2

            if text_y < 0:
                text_y = y2 + 2

            if text_x + text_w + 2 * pad > img.width:
                text_x = max(0, img.width - text_w - 2 * pad)

            if text_y + text_h + 2 * pad > img.height:
                text_y = max(0, img.height - text_h - 2 * pad)

            draw.rectangle(
                [text_x, text_y, text_x + text_w + 2 * pad, text_y + text_h + 2 * pad],
                fill=box_color
            )

            draw.text((text_x + pad, text_y + pad), label, fill=text_color, font=font)

    return img

def main():
    model = load_model(MODEL_PATH, MODEL_TYPE)

    results = model.predict(
        source=IMAGE_PATH,
        imgsz=IMGSZ,
        conf=CONF,
        save=False,
    )

    img = Image.open(IMAGE_PATH).convert("RGB")
    annotated = draw_detections(img, results, model)

    out_dir = Path(OUTPUT_DIR) / "predict"
    out_dir.mkdir(parents=True, exist_ok=True)

    out_path = out_dir / OUTPUT_NAME
    annotated.save(out_path)

    print(f"\nSaved predictions to: {out_path.resolve()}")


if __name__ == "__main__":
    main()