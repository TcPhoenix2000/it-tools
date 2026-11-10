// All randomness in the app goes through a cryptographically secure source (Web Crypto),
// as some tools use it to generate secrets (tokens, passwords, OTP secrets).

// Secure float in [0, 1) with 53 bits of entropy (same precision as Math.random)
function random(): number {
  const buffer = new Uint32Array(2);
  crypto.getRandomValues(buffer);
  return (buffer[0] * 2 ** 21 + (buffer[1] >>> 11)) / 2 ** 53;
}

const randFromArray = (array: unknown[]) => array[Math.floor(random() * array.length)];

const randIntFromInterval = (min: number, max: number) => Math.floor(random() * (max - min) + min);

// Durstenfeld shuffle
function shuffleArrayMutate<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

const shuffleArray = <T>(array: T[]): T[] => shuffleArrayMutate([...array]);

const shuffleString = (str: string, delimiter = ''): string => shuffleArrayMutate(str.split(delimiter)).join(delimiter);

const generateRandomId = () => `id-${random().toString(36).substring(2, 12)}`;

export {
  randFromArray,
  randIntFromInterval,
  random,
  shuffleArray,
  shuffleArrayMutate,
  shuffleString,
  generateRandomId,
};
