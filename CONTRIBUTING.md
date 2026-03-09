# Contributing to Texture Enhancer

Thanks for taking the time to contribute.

All types of contributions are welcome. Before opening a pull request, please
make sure your change is easy to review, documented when needed, and covered by
the appropriate checks.

## Code of Conduct

This project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Development Setup

1. Install Node.js 22+ and npm 10+.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and set any required API keys.
4. If you want to work on SAM masking locally, also start the self-hosted
   `sam-service` with Docker Compose and configure `HF_TOKEN` as needed for
   model access.
5. Start the app with `npm run dev`.

## Before You Open a Pull Request

Run the project checks locally:

```bash
npm run lint
npm test
npm run build
```

## AI-Assisted Contributions

Agentic and LLM-assisted contributions are allowed.

If you use AI tools to help research, generate, refactor, or review changes,
you are still responsible for the final pull request. Please make sure that:

- You understand the code you are submitting
- The change is tested and reviewed before submission
- Generated content does not include secrets, licensed third-party code copied
  without attribution, or fabricated claims
- Pull request descriptions clearly explain the actual change, regardless of how
  it was produced

## How Can I Contribute?

### Reporting Bugs

Bugs are tracked as GitHub issues. When creating an issue, include enough detail
to help maintainers reproduce the problem:

* **Use a clear and descriptive title** for the issue to identify the problem.
* **Describe the exact steps which reproduce the problem** in as many details as possible.
* **Provide specific examples to demonstrate the steps.** Include links to files or GitHub projects, or copy/pasteable snippets, which you use in those examples.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues.

* **Use a clear and descriptive title** for the issue to identify the suggestion.
* **Provide a step-by-step description of the suggested enhancement** in as many details as possible.

### Pull Requests

* Fill in the required template
* Do not include issue numbers in the PR title
* Include screenshots or recordings for UI changes whenever possible
* Keep pull requests focused and easy to review
* Document new behavior when it is not obvious from the code

## Styleguides

### Git Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line
