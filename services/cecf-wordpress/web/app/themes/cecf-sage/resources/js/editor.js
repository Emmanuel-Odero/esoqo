import domReady from '@wordpress/dom-ready';
import { registerCecfBlocks } from './blocks/register';

domReady(() => {
  registerCecfBlocks();
});
