# Idea to Stocks

A Command-Line Tool for Suggesting US Stocks based on Keywords using Large Language Models (LLMs)

## About 🎯

Idea to Stocks is a innovative command-line tool that leverages the power of Large Language Models (LLMs) to suggest stocks in the US market based on a simple keyword. This tool is designed to help users quickly generate stock ideas and explore new investment opportunities.

## Installation 📦

To get started with Idea to Stocks, follow these easy steps:

1. Install the required dependencies by running `pnpm install` in your terminal.
2. Configure your environment by creating a `.env` file with the following variables:
   ```
   OPENAI_BASE_URL=<url>
   OPENAI_API_KEY=<api_key>
   ```
   Replace `<url>` and `<api_key>` with your OpenAI account credentials.

## Usage 🔧

Once installed, you can use Idea to Stocks by providing a keyword as input. The tool will then use the LLM to suggest relevant stocks in the US market by:

Run the `search` script by typing `pnpm run search` in your terminal.