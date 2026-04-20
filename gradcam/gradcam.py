import os
import matplotlib.cm as cm
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing import image as keras_image
from PIL import Image

# -----------------------------
# Config
# -----------------------------
MODEL_PATH = "models/HELMINTHS_BINARY_VGG19_Round1.keras"
IMAGE_PATH = "test/helminths-003.jpg"
OUTPUT_PATH = "gradcam_overlay.jpg"
IMG_SIZE = (224, 224)   # change if your model expects something else
CLASS_NAMES = None  # or your list

def load_and_preprocess_image(img_path, target_size):
    img = keras_image.load_img(img_path, target_size=target_size)
    arr = keras_image.img_to_array(img).astype("float32") / 255.0
    arr = np.expand_dims(arr, axis=0)
    return img, arr


def build_gradcam_models(model, backbone_name="vgg19", last_conv_name="block5_conv4"):
    backbone = model.get_layer(backbone_name)
    last_conv_layer = backbone.get_layer(last_conv_name)

    # Model 1: input image -> last conv activation
    last_conv_layer_model = tf.keras.Model(
        backbone.input,
        last_conv_layer.output
    )

    # Model 2: last conv activation -> final prediction
    classifier_input = tf.keras.Input(shape=last_conv_layer.output.shape[1:])
    x = classifier_input

    # Continue through the remaining backbone layers after the chosen conv layer
    passed_target = False
    for layer in backbone.layers:
        if passed_target:
            x = layer(x)
        if layer.name == last_conv_name:
            passed_target = True

    # Then continue through the outer model layers after the backbone
    passed_backbone = False
    for layer in model.layers:
        if passed_backbone:
            x = layer(x)
        if layer.name == backbone_name:
            passed_backbone = True

    classifier_model = tf.keras.Model(classifier_input, x)
    return last_conv_layer_model, classifier_model


def make_gradcam_heatmap(img_array, last_conv_layer_model, classifier_model):
    img_tensor = tf.convert_to_tensor(img_array, dtype=tf.float32)

    with tf.GradientTape() as tape:
        last_conv_output = last_conv_layer_model(img_tensor, training=False)
        tape.watch(last_conv_output)

        preds = classifier_model(last_conv_output, training=False)

        # Binary sigmoid output
        prob = preds[:, 0]   # probability of positive class

    grads = tape.gradient(prob, last_conv_output)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))

    last_conv_output = last_conv_output[0]
    heatmap = tf.reduce_sum(last_conv_output * pooled_grads, axis=-1)

    heatmap = tf.maximum(heatmap, 0)
    max_val = tf.reduce_max(heatmap)
    if max_val > 0:
        heatmap /= max_val

    return heatmap.numpy(), preds.numpy()

def apply_heatmap(original_img, heatmap, alpha=0.35):
    import numpy as np
    from PIL import Image
    import matplotlib.cm as cm

    original = np.array(original_img).astype("float32")

    # Resize heatmap to image size
    heatmap_uint8 = np.uint8(255 * heatmap)

    raw = np.uint8(255 * heatmap)
    raw_img = Image.fromarray(raw)
    raw_img = raw_img.resize((512, 512), Image.NEAREST)
    raw_img.save("gradcam_raw_heatmap_large.png")

    heatmap_img = Image.fromarray(heatmap_uint8).resize(
        (original.shape[1], original.shape[0])
    )
    heatmap_uint8 = np.array(heatmap_img)

    # Apply colormap
    cmap = cm.get_cmap("jet")
    colored_heatmap = cmap(heatmap_uint8 / 255.0)[:, :, :3]  # drop alpha
    colored_heatmap = (colored_heatmap * 255).astype("float32")

    # Blend properly
    superimposed = original * (1 - alpha) + colored_heatmap * alpha
    superimposed = np.clip(superimposed, 0, 255).astype("uint8")

    return Image.fromarray(superimposed)

def main():
    model = load_model(MODEL_PATH)

    original_img, img_array = load_and_preprocess_image(IMAGE_PATH, IMG_SIZE)

    # Build once
    _ = model(tf.convert_to_tensor(img_array, dtype=tf.float32), training=False)

    last_conv_layer_model, classifier_model = build_gradcam_models(
        model,
        backbone_name="vgg19",
        last_conv_name="block5_conv4",
    )

    print("Using last conv layer: block5_conv4")

    heatmap, preds = make_gradcam_heatmap(
        img_array,
        last_conv_layer_model,
        classifier_model,
    )

    prob = float(preds[0][0])
    predicted_class = int(prob >= 0.5)

    print("Raw sigmoid probability:", prob)
    print("Predicted class:", predicted_class)
    print("Confidence:", prob if predicted_class == 1 else 1 - prob)
    
    if CLASS_NAMES:
        print("Predicted class:", CLASS_NAMES[pred_index])

    overlay = apply_heatmap(original_img, heatmap, alpha=0.4)
    overlay.save(OUTPUT_PATH)
    print("Saved:", OUTPUT_PATH)


if __name__ == "__main__":
    main()