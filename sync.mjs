import { program } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import fetch from "node-fetch";
import Trakt from "trakt.tv";
import { createSpinner } from "nanospinner";

program
  .name("Trakt Sync CLI")
  .description("Synchronize your watch history from Simkl to Trakt.")
  .version("1.0.0");

const validateInput = (input) => !!input || "This field cannot be empty!";

async function getSimklWatched(clientId) {
  const spinner = createSpinner("Authorizing Simkl...").start();
  const { user_code, verification_url } = await fetch(
    `https://api.simkl.com/oauth/pin?client_id=${clientId}`
  ).then((res) => res.json());

  console.log(
    chalk.cyan(
      `Please authorize the Simkl application by visiting: ${verification_url} and using this code: ${user_code}`
    )
  );
  await inquirer.prompt({
    type: "confirm",
    name: "confirmed",
    message: "Hit Enter once you have authorized.",
  });

  const { access_token } = await fetch(
    `https://api.simkl.com/oauth/pin/${user_code}?client_id=${clientId}`
  ).then((res) => res.json());
  const data = await fetch(
    "https://api.simkl.com/sync/all-items/?extended=full&episode_watched_at=yes",
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
        "simkl-api-key": clientId,
      },
    }
  ).then((res) => res.json());

  spinner.success({ text: "Simkl authorization successful." });
  return data;
}
async function main() {
  const answers = await inquirer.prompt([
    {
      type: "input",
      message:
        "Please input your Simkl client ID (get it from https://simkl.com/settings/developer/new by creating a new application)\n",
      name: "simkl_client_id",
      validate,
    },
    {
      type: "input",
      message:
        "Please input your Trakt client ID (get it from https://trakt.tv/oauth/applications by creating a new application):\n",
      name: "client_id",
      validate,
    },
    {
      type: "input",
      message:
        "Please input your Trakt client secret (you get it from the same place you got the client ID):\n",
      name: "client_secret",
      validate,
    },
    {
      type: "confirm",
      message: "Do you want to delete your previous Trakt history? ",
      name: "remove_previous",
      default: false,
    },
  ]);
  const spinner = createSpinner("Fetching watch history...").start();
  const watched = await getSimklWatched(answers.simkl_client_id);
  spinner.success({ text: "Watch history fetched successfully." });

  const trakt = new Trakt({
    client_id: answers.client_id,
    client_secret: answers.client_secret,
  });
  try {
    const poll = await trakt.get_codes();
    console.log(
      chalk.blue(
        `Authorize the Trakt application via: ${poll.verification_url} using this code: ${poll.user_code}`
      )
    );
    await trakt.poll_access(poll);
    spinner.success({ text: "Trakt authorization successful." });

    if (answers.remove_previous) {
      try {
        console.log("Getting previous watch history...");
        const movies = await trakt.sync
          .watched({ type: "movies" })
          .then((movie) => movie.map((mv) => mv.movie));
        const shows = await trakt.sync
          .watched({ type: "shows" })
          .then((show) => show.map((sh) => sh.show));
        console.log(
          `Removing ${movies.length} movies and ${shows.length} shows from your Trakt watchlist...`
        );
        await trakt.sync.history.remove({ movies, shows }).then((res) => {
          console.log(
            `Succesfully removed ${res.deleted.movies} movies and ${res.deleted.episodes} episodes your watch history.`
          );
          sync(watched);
        });
      } catch {
        const answer = await inquirer.prompt([
          {
            name: "confirm",
            message:
              "The watch history could not be removed for various reasons (maybe your watch history is too big), continue syncing?",
            default: true,
            type: "boolean",
          },
        ]);
        if (answer) await sync(watched);
        else process.exit(0);
      }
    }

    await sync(watched, trakt);
  } catch (error) {
    spinner.error({ text: `Error: ${error.message}` });
  }
}

async function sync(watched, trakt) {
  const traktObject = {
    shows: [],
    movies: [],
  };

  watched.shows.forEach((show) => {
    if (!show.last_watched_at) return;
    traktObject.shows.push({
      watched_at: show.last_watched_at,
      title: show.show.title,
      year: show.show.year,
      seasons: show.seasons,
      ids: {
        mal: show.show.ids.mal,
        imdb: show.show.ids.imdb,
        tmdb: show.show.ids.tmdb,
        anidb: show.show.ids.anidb,
      },
    });
  });

  watched.movies.forEach((movie) => {
    if (!movie.last_watched_at) return;
    traktObject.movies.push({
      watched_at: movie.last_watched_at,
      title: movie.movie.title,
      year: movie.movie.year,
      ids: {
        slug: movie.movie.ids.slug,
        imdb: movie.movie.ids.imdb,
        tmdb: movie.movie.ids.tmdb,
      },
    });
  });

  watched.anime.forEach((anime) => {
    if (!anime.last_watched_at) return;
    traktObject.shows.push({
      watched_at: anime.last_watched_at,
      title: anime.show.title,
      year: anime.show.year,
      seasons: anime.seasons,
      ids: {
        mal: anime.show.ids.mal,
        imdb: anime.show.ids.imdb,
        tmdb: anime.show.ids.tmdb,
        anidb: anime.show.ids.anidb,
      },
    });
  });

  console.log(
    `Syncing ${traktObject.shows.length} shows (incl. anime) and ${traktObject.movies.length} movies to your Trakt account...`
  );
  await trakt.sync.history
    .add(traktObject)
    .then((res) =>
      console.log(
        `Successfully added ${res.added.movies} movies and ${res.added.episodes} episodes to your Trakt watch history!`
      )
    );
}

function validate(string) {
  if (!string) return "Please input the required string!";
  else return true;
}
program
  .command("sync")
  .description("Sync watch history from Simkl to Trakt")
  .action(main);

program.parse(process.argv);
