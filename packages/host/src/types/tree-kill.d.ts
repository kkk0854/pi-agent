declare module 'tree-kill' {
  /**
   * 进程树终止：Windows 用 taskkill /T /F，POSIX 向进程组发信号。
   * 官方包未携带类型，此处按实际签名声明。
   */
  function treeKill(pid: number, signal?: string, callback?: (err?: Error) => void): void;
  export = treeKill;
}
