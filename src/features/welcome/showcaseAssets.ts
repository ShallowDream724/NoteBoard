import morning from '../../../examples/assets/morning.png?url';
import forest from '../../../examples/assets/forest.png?url';
import evening from '../../../examples/assets/evening.png?url';
import { storeTransientImage } from '../editor-md/imageAssetStorage';

/** The build owns these three URLs. Documents receive durable recovery paths,
 * never a dev-server URL or an installation's hashed bundle filename. */
export async function prepareShowcaseAssets(content: string): Promise<string> {
  for (const [name, url] of [['morning', morning], ['forest', forest], ['evening', evening]]) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`无法加载示例图片：${name}`);
    const source = await storeTransientImage(new Uint8Array(await response.arrayBuffer()), `${name}.png`, 'image/png');
    content = content.replaceAll(JSON.stringify(`./assets/${name}.png`), JSON.stringify(source));
  }
  return content;
}
