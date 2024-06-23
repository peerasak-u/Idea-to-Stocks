import { extractJsonFromString } from "extract-json-from-string-y";
import yahooFinance from "yahoo-finance2";
import readline from "readline";
import OpenAI from "openai";
import dotenv from "dotenv";
import chalk from "chalk";
import fs from "fs";

dotenv.config();

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});

const askMoreChoices = [
  { title: "Competitors", isSelected: false },
  {
    title: "Suppliers",
    isSelected: false,
  },
  {
    title: "List more other stocks",
    isSelected: false,
  },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (questionText) =>
  new Promise((resolve) => rl.question(questionText, resolve));

const recordConversation = async (system, user, assistant, isContinue) => {
  if (!isContinue) {
    const conversations = [
      {
        role: "system",
        content: system,
      },
      {
        role: "user",
        content: user,
      },
      {
        role: "assistant",
        content: assistant,
      },
    ];

    await fs.promises.writeFile(
      "./conversations.json",
      JSON.stringify(conversations, null, 2)
    );
  } else {
    const conversations = JSON.parse(
      await fs.promises.readFile("./conversations.json", "utf8")
    );

    conversations.push({
      role: "user",
      content: user,
    });

    conversations.push({
      role: "assistant",
      content: assistant,
    });

    await fs.promises.writeFile(
      "./conversations.json",
      JSON.stringify(conversations, null, 2)
    );
  }
};

const callOpenAI = async (messages) => {
  const completion = await openai.chat.completions.create({
    messages: messages,
    model: "llama3-70b-8192",
  });

  return completion.choices[0].message.content;
};

const getCompletion = async (systemPrompt, userPrompt) => {
  return callOpenAI([
    {
      role: "system",
      content: systemPrompt,
    },
    { role: "user", content: userPrompt },
  ]);
};

const verifyInputMessage = async (message, maxRetries = 3) => {
  const system = await fs.promises.readFile("./prompts/input-guard.md", "utf8");
  const user = `Keyword is "${message}"`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Waiting for 2 seconds before attempt ${attempt}...`);
        await delay(2000); // Wait for 2 seconds
      }

      const completion = await getCompletion(system, user);
      const detectedJsons = extractJsonFromString(completion);

      if (detectedJsons.length > 0) {
        const latestIndex = detectedJsons.length - 1;
        return detectedJsons[latestIndex];
      }

      if (attempt === maxRetries) {
        throw new Error(
          "No JSON found in the completion after maximum retries"
        );
      }

      console.log(`Attempt ${attempt}: No JSON found. Retrying...`);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.error(`Attempt ${attempt} failed:`, error.message);
    }
  }
};

const suggestNewKeywords = async (keyword, reason) => {
  const system = await fs.promises.readFile(
    "./prompts/suggest-keyword.md",
    "utf8"
  );
  const user = `Keyword is "${keyword}" and the reason is "${reason}"`;
  const completion = await getCompletion(system, user);
  const detectedJsons = extractJsonFromString(completion);
  const latestIndex = Math.max(0, detectedJsons.length - 1);
  const result = detectedJsons[latestIndex];
  return result;
};

const ensureKeyword = async (keyword) => {
  const system = await fs.promises.readFile(
    "./prompts/ensure-keyword.md",
    "utf8"
  );
  const user = `Keyword is "${keyword}"`;
  const completion = await getCompletion(system, user);
  const detectedJsons = extractJsonFromString(completion);
  const latestIndex = Math.max(0, detectedJsons.length - 1);
  const result = detectedJsons[latestIndex];
  return result;
};

const searchStockBySymbol = async (symbol) => {
  const { quotes } = await yahooFinance.search(symbol);
  const filtered = quotes.filter((quote) => {
    const expectedExchDisps = ["NASDAQ", "NYSE", "AMEX"];
    return expectedExchDisps.includes(quote.exchDisp) && quote.symbol == symbol;
  });

  if (filtered.length > 0) {
    return filtered[0];
  }

  return null;
};

const verifyAllStocks = async (stocks) => {
  const { exactMatch, otherMatchingStocks } = stocks;
  const exactChecked = await searchStockBySymbol(exactMatch.symbol);

  const otherChecked = await Promise.all(
    otherMatchingStocks.map((stock) => searchStockBySymbol(stock.symbol))
  );

  const newExactMatch = exactChecked ? exactMatch : null;
  const newOtherMatchingStocks = otherChecked
    .filter((stock) => stock !== null)
    .map((stock) => {
      const matchingStock = otherMatchingStocks.find(
        (s) => s.symbol === stock.symbol
      );
      return matchingStock;
    });

  return {
    exactMatch: newExactMatch,
    otherMatchingStocks: newOtherMatchingStocks,
  };
};

const verifyAdditionalStocks = async (stocks) => {
  const checked = await Promise.all(
    stocks.map((stock) => searchStockBySymbol(stock.symbol))
  );

  const newStocks = checked
    .filter((stock) => stock !== null)
    .map((stock) => {
      const matchingStock = stocks.find((s) => s.symbol === stock.symbol);
      return matchingStock;
    });

  return newStocks;
};

const responseWithSuggession = async (keyword, reason) => {
  const { suggestion, keywords } = await suggestNewKeywords(keyword, reason);
  console.log(chalk.yellow(suggestion));
  keywords.forEach((k, index) => console.log(chalk.cyan(`${index + 1}. ${k}`)));

  const selectedIndex = await askQuestion(
    chalk.yellow("\nPlease choose a new keyword by entering the number: ")
  );

  const newKeywordIndex = parseInt(selectedIndex, 10) - 1;

  if (!isNaN(newKeywordIndex) && keywords[newKeywordIndex]) {
    await main(keywords[newKeywordIndex]);
  } else {
    console.log(chalk.red("Invalid selection. Please try again."));
    rl.close();
  }
};

const responseWithContextChoices = async (keyword, contexts) => {
  console.log(
    chalk.bold.blue(`\n"${keyword}"`) +
      chalk.yellow(" is unclear. Do you mean any of these?")
  );
  contexts.forEach((context, index) =>
    console.log(chalk.cyan(`${index + 1}. ${context}`))
  );

  const selectedIndex = await askQuestion(
    chalk.yellow("\nPlease choose a context by entering the number: ")
  );

  const selectedContextIndex = parseInt(selectedIndex, 10) - 1;

  if (!isNaN(selectedContextIndex) && contexts[selectedContextIndex]) {
    const stocks = await suggestStocks(keyword, contexts[selectedContextIndex]);
    await responseSuggestStocks(stocks);

    rl.close();
  } else {
    console.log(chalk.red("Invalid selection. Please try again."));
    rl.close();
  }
};

const askForMoreContext = async () => {
  const choices = askMoreChoices
    .filter((c) => c.isSelected === false)
    .map((c) => c.title);

  if (choices.length === 0) {
    return;
  }

  console.log(chalk.yellow("\nWhich topic do you want to know more about?"));
  choices.forEach((choice, index) =>
    console.log(chalk.cyan(`${index + 1}. ${choice}`))
  );
  const selectedIndex = await askQuestion(
    chalk.yellow("\nPlease choose a topic by entering the number: ")
  );

  const selectedTopicIndex = parseInt(selectedIndex, 10) - 1;

  if (!isNaN(selectedTopicIndex) && choices[selectedTopicIndex]) {
    const selectedTopic = choices[selectedTopicIndex];
    const additionalStocks = await suggestMoreWithContext(selectedTopic);
    await responseMoreSuggestStocks(selectedTopic, additionalStocks);
    // update choices
    askMoreChoices.find((c) => c.title === selectedTopic).isSelected = true;

    // ask again
    await askForMoreContext();
  } else {
    console.log(chalk.red("Invalid selection. Please try again."));
    rl.close();
  }
};

const suggestStocks = async (keyword, context, maxRetries = 3) => {
  const system = await fs.promises.readFile(
    "./prompts/suggest-stocks.md",
    "utf8"
  );

  const contextSentence = context
    ? `. and the context is "${context}"`
    : ". and nothing more context";

  const user = `Keyword is "${keyword}"${contextSentence}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Waiting for 2 seconds before attempt ${attempt}...`);
        await delay(2000); // Wait for 2 seconds
      }

      const completion = await getCompletion(system, user);
      await recordConversation(system, user, completion, false);
      const detectedJsons = extractJsonFromString(completion);

      if (detectedJsons.length > 0) {
        const latestIndex = detectedJsons.length - 1;
        return detectedJsons[latestIndex];
      }

      if (attempt === maxRetries) {
        throw new Error(
          "No JSON found in the completion after maximum retries"
        );
      }

      console.log(`Attempt ${attempt}: No JSON found. Retrying...`);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.error(`Attempt ${attempt} failed:`, error.message);
    }
  }
};

const suggestMoreWithContext = async (context, maxRetries = 3) => {
  const conversationString = await fs.promises.readFile(
    "./conversations.json",
    "utf8"
  );
  let conversation = JSON.parse(conversationString);

  const user = {
    role: "user",
    content: `List more stocks that are related to the context "${context}"`,
  };
  conversation.push(user);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Waiting for 2 seconds before attempt ${attempt}...`);
        await delay(2000); // Wait for 2 seconds
      }

      const completion = await callOpenAI(conversation);
      await recordConversation(null, user.content, completion, true);
      const detectedJsons = extractJsonFromString(completion);

      if (detectedJsons.length > 0) {
        const latestIndex = detectedJsons.length - 1;
        return detectedJsons[latestIndex];
      }

      if (attempt === maxRetries) {
        throw new Error(
          "No JSON found in the completion after maximum retries"
        );
      }

      console.log(`Attempt ${attempt}: No JSON found. Retrying...`);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.error(`Attempt ${attempt} failed:`, error.message);
    }
  }
};

const responseSuggestStocks = async (stocks) => {
  const checked = await verifyAllStocks(stocks);

  console.log(chalk.bold.black.bgGreen("\n -= Exact Match =- \n"));
  if (checked.exactMatch) {
    const symbol = chalk.bold.green(checked.exactMatch.symbol);
    const explanation = chalk.white(checked.exactMatch.explanation);
    console.log(`- ${symbol}: ${explanation}`);
  } else {
    console.log(chalk.dim("- No exact match found."));
  }

  console.log(chalk.bold.black.bgYellow("\n -= Other Matches =- \n"));
  if (checked.otherMatchingStocks.length > 0) {
    checked.otherMatchingStocks.forEach((stock) => {
      const symbol = chalk.bold.yellow(stock.symbol);
      const explanation = chalk.white(stock.explanation);
      console.log(`- ${symbol}: ${explanation}`);
    });
  } else {
    console.log(chalk.dim("- No other matching stocks found."));
  }

  await askForMoreContext();
};

const responseMoreSuggestStocks = async (topic, stocks) => {
  const verifiedStocks = await verifyAdditionalStocks(stocks);
  console.log(chalk.bold.black.bgYellow(`\n -= ${topic} =- \n`));
  if (verifiedStocks.length > 0) {
    verifiedStocks.forEach((stock) => {
      const symbol = chalk.bold.yellow(stock.symbol);
      const explanation = chalk.white(stock.explanation);
      console.log(`- ${symbol}: ${explanation}`);
    });
  } else {
    console.log(chalk.dim(`- No ${topic} found.`));
  }
};

const main = async (keyword) => {
  const verified = await verifyInputMessage(keyword);

  if (verified.isValid === false) {
    await responseWithSuggession(keyword, verified.reason);
    rl.close();
    return;
  }

  const ensure = await ensureKeyword(keyword);

  if (ensure.isReady === false) {
    await responseWithContextChoices(keyword, ensure.additionalContext);
    rl.close();
    return;
  }

  const stocks = await suggestStocks(keyword);
  await responseSuggestStocks(stocks);

  rl.close();
};

rl.question(chalk.yellow("Please enter the keyword: "), main);
