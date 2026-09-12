export class Queue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<PromiseWithResolvers<T>> = [];

  push(item: T) {
    const waiter = this.waiters.shift();

    if (waiter) {
      waiter.resolve(item);
      return;
    }

    this.items.push(item);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift() as T;
        continue;
      }

      const waiter = Promise.withResolvers<T>();
      this.waiters.push(waiter);
      yield await waiter.promise;
    }
  }
}
