import { describe, it, expect } from 'vitest';
import { isMobileUA } from '../mobile.js';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const DESKTOP_FIREFOX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';
const DESKTOP_SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('isMobileUA', () => {
  it('returns true for iPhone', () => {
    expect(isMobileUA(IPHONE_UA)).toBe(true);
  });

  it('returns true for iPad', () => {
    expect(isMobileUA(IPAD_UA)).toBe(true);
  });

  it('returns true for Android phone', () => {
    expect(isMobileUA(ANDROID_PHONE_UA)).toBe(true);
  });

  it('returns true for Android tablet', () => {
    expect(isMobileUA(ANDROID_TABLET_UA)).toBe(true);
  });

  it('returns false for desktop Chrome', () => {
    expect(isMobileUA(DESKTOP_CHROME_UA)).toBe(false);
  });

  it('returns false for desktop Firefox', () => {
    expect(isMobileUA(DESKTOP_FIREFOX_UA)).toBe(false);
  });

  it('returns false for desktop Safari', () => {
    expect(isMobileUA(DESKTOP_SAFARI_UA)).toBe(false);
  });
});
