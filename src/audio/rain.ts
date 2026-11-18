export async function loadRainLoop(context: BaseAudioContext): Promise<AudioBuffer> {
  const base = new URL(import.meta.env.BASE_URL, location.href);
  const response = await fetch(new URL('audio/rain-ambience.mp3', base));
  if (!response.ok) throw new Error(`Rain recording request failed (${response.status})`);
  return context.decodeAudioData(await response.arrayBuffer());
}
