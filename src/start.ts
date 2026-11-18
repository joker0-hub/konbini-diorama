import './style.css';
import { opening } from './ui/intro';

// Mount the loading screen before requesting the 3D scene bundle.
void import('./main').catch((error: unknown) => {
  opening.fail();
  console.error('Unable to initialize the scene', error);
});
