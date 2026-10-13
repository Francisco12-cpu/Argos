import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectInAppBrowser } from '../src/ui/environment.js';

const UA = {
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0.29.109 (iPhone15,3; iOS 18_5; pt_BR; pt; scale=3.00; 1290x2796)',
  facebook:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/485.0.0.62.79;]',
  tiktok:
    'Mozilla/5.0 (Linux; Android 13; moto g84) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 trill_340903 BytedanceWebview/d8a21c6',
  chrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
};

describe('detectInAppBrowser', () => {
  it('reconhece os navegadores internos mais comuns', () => {
    assert.equal(detectInAppBrowser(UA.instagram), 'Instagram');
    assert.equal(detectInAppBrowser(UA.facebook), 'Facebook');
    assert.equal(detectInAppBrowser(UA.tiktok), 'TikTok');
  });

  it('não acusa Chrome nem Safari', () => {
    assert.equal(detectInAppBrowser(UA.chrome), null);
    assert.equal(detectInAppBrowser(UA.safari), null);
  });
});
