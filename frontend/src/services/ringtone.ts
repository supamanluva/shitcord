/**
 * Ring Tone Service
 *
 * Generates ring tones using the Web Audio API.
 * No external audio files needed — all synthesized.
 */

class RingToneService {
  private audioContext: AudioContext | null = null
  private outgoingInterval: ReturnType<typeof setInterval> | null = null
  private incomingInterval: ReturnType<typeof setInterval> | null = null
  private activeOscillators: OscillatorNode[] = []
  private activeGains: GainNode[] = []

  private getContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext()
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }
    return this.audioContext
  }

  /**
   * Play a single ring "beep" (two-tone, phone-style)
   */
  private playBeep(frequency1: number, frequency2: number, duration: number, volume = 0.15): void {
    const ctx = this.getContext()

    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()

    osc1.type = 'sine'
    osc1.frequency.value = frequency1
    osc2.type = 'sine'
    osc2.frequency.value = frequency2

    gain.gain.value = volume

    osc1.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)

    const now = ctx.currentTime
    osc1.start(now)
    osc2.start(now)

    // Fade out at the end for a smooth sound
    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    osc1.stop(now + duration)
    osc2.stop(now + duration)
  }

  /**
   * Start the outgoing ring tone (caller hears this while waiting).
   * Sounds like a phone ringing: two short beeps, then silence.
   */
  startOutgoingRing(): void {
    this.stopOutgoingRing()

    // Play immediately, then repeat
    const ringCycle = () => {
      this.playBeep(440, 480, 0.8, 0.12) // US ring tone frequencies
    }

    ringCycle()
    // Ring pattern: 0.8s on, 3.2s off (like a real phone)
    this.outgoingInterval = setInterval(ringCycle, 4000)
  }

  /**
   * Stop the outgoing ring tone.
   */
  stopOutgoingRing(): void {
    if (this.outgoingInterval) {
      clearInterval(this.outgoingInterval)
      this.outgoingInterval = null
    }
  }

  /**
   * Start the incoming ring tone (callee hears this).
   * More urgent: alternating two-tone pattern.
   */
  startIncomingRing(): void {
    this.stopIncomingRing()

    const ringCycle = () => {
      // Two quick beeps
      this.playBeep(523, 659, 0.3, 0.18)  // C5 + E5
      setTimeout(() => {
        this.playBeep(523, 659, 0.3, 0.18)
      }, 400)
    }

    ringCycle()
    // Ring pattern: two beeps (0.7s total), then 2.3s silence
    this.incomingInterval = setInterval(ringCycle, 3000)
  }

  /**
   * Stop the incoming ring tone.
   */
  stopIncomingRing(): void {
    if (this.incomingInterval) {
      clearInterval(this.incomingInterval)
      this.incomingInterval = null
    }
  }

  /**
   * Stop all ring tones.
   */
  stopAll(): void {
    this.stopOutgoingRing()
    this.stopIncomingRing()
  }

  /**
   * Play a short notification sound (for events like member join).
   */
  playNotification(): void {
    this.playBeep(800, 1000, 0.15, 0.08)
  }
}

export const ringToneService = new RingToneService()
