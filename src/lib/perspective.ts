/**
 * CSS `matrix3d` that maps a w×h box (origin top-left) onto a quadrilateral —
 * corners top-left, top-right, bottom-right, bottom-left — so flat content can be
 * drawn onto a surface seen at an angle, such as a laptop screen in a photo.
 */
export function quadTransform(w: number, h: number, quad: [number, number][]): string {
  const src = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = quad[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const [m11, m12, m13, m21, m22, m23, m31, m32] = solve(A, b)
  // Column-major: X = m11·x + m12·y + m13, Y = m21·x + m22·y + m23, W = m31·x + m32·y + 1.
  return `matrix3d(${m11},${m21},0,${m31},${m12},${m22},0,${m32},0,0,1,0,${m13},${m23},0,1)`
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col]
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n]
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c]
    x[r] = sum / M[r][r]
  }
  return x
}
