'use server';

export const generateThreadName = async (message: string): Promise<string> => {
  const trimmed = (message || '').trim();
  if (!trimmed) {
    return 'New thread';
  }
  return trimmed.length > 50 ? `${trimmed.substring(0, 47)}...` : trimmed;
};
