import { describe, expect, it } from 'vitest';
import { detectKeywords } from '../templates.js';

describe('detectKeywords', () => {
  it('detects Korean trigger keywords as standalone tokens', () => {
    const found = detectKeywords('버그 수정 완료');
    expect(found).toContain('버그');
    expect(found).toContain('수정');
  });

  it('does not match Korean keyword by partial containment', () => {
    const found = detectKeywords('디버그 로그를 확인했다');
    expect(found).not.toContain('버그');
  });

  it('keeps English word-boundary false-positive guard', () => {
    const found = detectKeywords('debugging done');
    expect(found).not.toContain('bug');
  });
});
