import { getErrorMessage } from './errorMessages.js';
import { ERROR_CODES } from '../errors.js';

describe('getErrorMessage', () => {
  test('Her hata kodu için tanımlı bir mesaj vardır', () => {
    const fallback = getErrorMessage({ code: ERROR_CODES.UNEXPECTED });
    for (const code of Object.values(ERROR_CODES)) {
      const message = getErrorMessage({ code });
      expect(typeof message).toBe('string');
      // UNEXPECTED dışındaki kodlar genel mesaja düşmemeli.
      if (code !== ERROR_CODES.UNEXPECTED) expect(message).not.toBe(fallback);
    }
  });

  test.each([null, undefined, {}, { code: 'SOMETHING_NEW' }])('Bilinmeyen girdi genel mesaja düşer: %p', (error) => {
    expect(getErrorMessage(error)).toBe(getErrorMessage({ code: ERROR_CODES.UNEXPECTED }));
  });
});
