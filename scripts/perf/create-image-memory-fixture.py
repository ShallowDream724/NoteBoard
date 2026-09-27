from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image

target = Path('.tmp/image-memory-fixture'); target.mkdir(exist_ok=True)
width,height=3840,2160
x=np.arange(width,dtype=np.uint32)[None,:]
y=np.arange(height,dtype=np.uint32)[:,None]
rows=[]
for index in range(4):
    data=np.empty((height,width,3),dtype=np.uint8)
    for channel in range(3):
        data[:,:,channel]=((x*(channel+1)//13+y*(index+1)//11+(x//96+y//80)%2*47+index*53+channel*71)%256).astype(np.uint8)
    path=target/f'image-{index}.png'
    Image.fromarray(data).save(path,compress_level=6)
    rows.append({'file':path.name,'width':width,'height':height,'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(target/'manifest.json').write_text(json.dumps(rows,indent=2))
print(json.dumps(rows))
