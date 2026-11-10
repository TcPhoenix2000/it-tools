import { randIntFromInterval } from '@/utils/random';

export function createToken({
  withUppercase = true,
  withLowercase = true,
  withNumbers = true,
  withSymbols = false,
  length = 64,
  alphabet,
}: {
  withUppercase?: boolean
  withLowercase?: boolean
  withNumbers?: boolean
  withSymbols?: boolean
  length?: number
  alphabet?: string
}) {
  const allAlphabet = alphabet ?? [
    withUppercase ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '',
    withLowercase ? 'abcdefghijklmnopqrstuvwxyz' : '',
    withNumbers ? '0123456789' : '',
    withSymbols ? '.,;:!?/-"\'#{([|\\@)]=}*+' : '',
  ].join('');

  if (allAlphabet.length === 0) {
    return '';
  }

  // Each character is drawn independently and uniformly from the alphabet using a CSPRNG
  return Array.from({ length }, () => allAlphabet[randIntFromInterval(0, allAlphabet.length)]).join('');
}
