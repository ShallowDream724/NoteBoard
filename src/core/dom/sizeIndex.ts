/** Prefix sums for positive virtual row/column sizes. O(n) construction,
 * O(log n) point updates and coordinate lookup; no scan on scroll. */
export class SizeIndex {
  private readonly tree: Float64Array;
  private readonly values: Float64Array;

  constructor(values: ArrayLike<number>) {
    this.values = Float64Array.from(values);
    this.tree = new Float64Array(values.length + 1);
    for (let i = 1; i < this.tree.length; i++) {
      if (!(this.values[i - 1] > 0) || !Number.isFinite(this.values[i - 1])) throw new RangeError('Sizes must be positive and finite');
      this.tree[i] += this.values[i - 1];
      const parent = i + (i & -i);
      if (parent < this.tree.length) this.tree[parent] += this.tree[i];
    }
  }

  get length() { return this.values.length; }
  get total() { return this.prefix(this.length); }
  at(index: number) { return this.values[index]; }

  prefix(end: number): number {
    let sum = 0;
    for (let i = Math.min(end, this.length); i > 0; i -= i & -i) sum += this.tree[i];
    return sum;
  }

  set(index: number, value: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.length || !(value > 0) || !Number.isFinite(value)) {
      throw new RangeError('Invalid size index or value');
    }
    const delta = value - this.values[index];
    this.values[index] = value;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
    return delta;
  }

  indexAt(offset: number): number {
    let index = 0, sum = 0;
    for (let bit = 2 ** Math.floor(Math.log2(Math.max(1, this.length))); bit; bit >>= 1) {
      const next = index + bit;
      if (next <= this.length && sum + this.tree[next] <= offset) {
        index = next;
        sum += this.tree[next];
      }
    }
    return Math.min(index, Math.max(0, this.length - 1));
  }
}
