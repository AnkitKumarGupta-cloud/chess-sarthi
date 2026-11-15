import sys, json, numpy as np
from PIL import Image
for t in json.load(open(sys.argv[1])):
    im = Image.open(t["file"]).convert("RGBA"); np.asarray(im).tofile(t["file"].replace(".png", ".raw"))
    open(t["file"].replace(".png", ".dim"), "w").write(f"{im.width} {im.height}")
