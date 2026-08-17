export class PortfolioError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "PortfolioError";
  }
}
