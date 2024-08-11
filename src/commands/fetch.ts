import Discord, { Message } from 'discord.js';
import Row from '../row';
import { fetchEHApi, fetchNHApi } from '../utils/api';
import { decode } from 'html-entities';
import axios, { AxiosResponse } from 'axios';
const JSSoup = require('jssoup').default;

import underageCharacters from '../../data/underage.json';
import renameParodies from '../../data/parodies.json';
import renameCharacters from '../../data/characters.json';
import renameAuthors from '../../data/authors.json';
import ignoredTags from '../../data/ignoredtags.json';
import suggestTagsNotes from '../../data/suggestions.json';

function capitalize(string: string): string {
	return string.replace(/(?:^|\s+)(\w{1})/g, (letter) => letter.toUpperCase());
}

interface Tags {
	name: string,
	type: string,
}

/**
 * set fetched information in the row
 */
export async function setFetchedFields(message: Message, list: number, row: Row) {
	const siteTags = JSON.parse(row.siteTags ?? '{}');

	if (list != 4 && list != 9 && (row.eh?.match(/e-hentai/) || row.nh?.match(/nhentai|fakku/)) && (!row.parody || !row.author || !row.title || !siteTags.tags?.length || !siteTags.characters?.length)) {
		const fetched = await fetchInfo(message, row);

		if (!fetched || 'error' in fetched) {
			message.channel.send(fetched.error ?? 'Failed to fetch the missing fields!');
			return;
		} else {
			if (!row.author) {
				if (fetched.author) {
					row.author = fetched.author;
					await message.channel.send(`Updated missing author \`${row.author}\`!`);
				} else {
					await message.channel.send(`**This work has no listed author, please enter the name manually**`);
				}
			}

			if (!row.title) {
				if (fetched.title) {
					row.title = fetched.title;
					await message.channel.send(`Updated missing title \`${row.title}\`!`);
				} else {
					await message.channel.send(`**Failed to fetch the title, please enter it manually**`);
				}
			}

			if (!row.parody) {
				if (fetched.parodies.length) {
					row.parody = fetched.parodies.join(', ');
					await message.channel.send(`Updated missing parody \`${row.parody}\`!`);
				} else if (siteTags.characters?.length || fetched.siteTags.characters?.length) {
					await message.channel.send(`**Entry contains parody characters but it's missing a parody!**`);
				} else {
					await message.channel.send(`No parodies detected.`);
				}
			}

			if (fetched.siteTags.tags?.length || fetched.siteTags.characters?.length) {
				if (!row.siteTags) {
					row.siteTags = JSON.stringify(fetched.siteTags);
					await message.channel.send(`Updated missing tags!`);
				} else if (siteTags.tags?.length || siteTags.characters?.length) {
					if (!siteTags.tags?.length && fetched.siteTags.tags?.length) {
						siteTags.tags = [...fetched.siteTags.tags];
						await message.channel.send(`Updated missing tags!`);
					}

					if (!siteTags.characters?.length && fetched.siteTags.characters?.length) {
						siteTags.characters = [...fetched.siteTags.characters];
						await message.channel.send(`Updated missing characters!`);
					}

					row.siteTags = JSON.stringify(siteTags);
				}

				if (row.parody && !fetched.siteTags.characters?.length && !siteTags.characters?.length) {
					await message.channel.send(`**Entry contains the parody \`${row.parody}\` but it's missing the characters!**`);
				}
			}

			if (list == 2 || list == 6) {
				await suggestFields(message, row);
			}
		}
	}
}

/**
 * Check for underage characters
 */
function underageCheck(characters: string[], parodies: string[], message: Message) {
	const detectedCharacters = [];

	for (let i = 0; i < characters.length; i++) {
		const curChar = characters[i].toLowerCase();

		if (curChar in underageCharacters) {
			const curList = underageCharacters[curChar as keyof typeof underageCharacters];

			for (let j = 0; j < parodies.length; j++) {
				for (let k = 0; k < curList.length; k++) {
					const seriesList = curList[k]['series'];

					for (let l = 0; l < seriesList.length; l++) {
						if (seriesList[l].toLowerCase().trim() === parodies[j].toLowerCase().trim()) {
							detectedCharacters.push([curChar, seriesList[l], curList[k]['age'], curList[k]['note']]);
						}
					}
				}
			}
		}
	}

	if (detectedCharacters.length) {
		let characterStr = '';

		for (let i = 0; i < detectedCharacters.length; i++) {
			characterStr += '* ' + capitalize(detectedCharacters[i][0]);
			characterStr += ', aged ' + detectedCharacters[i][2];
			characterStr += ', from ' + detectedCharacters[i][1];

			if (detectedCharacters[i][3]) {
				characterStr += ' (Note: ' + detectedCharacters[i][3] + ')';
			}

			characterStr += '\n';
		}

		const embed = new Discord.EmbedBuilder()
			.setTitle(`Underage character(s) detected!`)
			.setDescription(characterStr + '\n*If there is a note, make sure none of the exceptions apply before deleting.*');

		message.channel.send({ embeds: [embed] });
	}
}

/**
 * Automatically suggests a note and tags based on fetched information
 */
export async function suggestFields(message: Message, row: Row, fields?: string) {
	const url = row.eh && row.eh != 'null' ? row.eh : row.nh ?? '';

	if (!url.match(/e-hentai|fakku/)) {
		if (fields) {
			message.channel.send(`Failed to suggest requested fields! Entry doesn't contain a FAKKU/E-Hentai link`);
		}
		return;
	} else {
		try {
			const suggestions: { note: Set<string>; tags: Set<string> } = {
				note: new Set(),
				tags: new Set(),
			};
			const siteTags: string[] = [];

			if (url.match(/e-hentai/)) {
				const data = await fetchEHApi(url);
				const title = data.title.toLowerCase();
				const ehentai = suggestTagsNotes.ehentai;

				siteTags.push(...data.tags);

				if (data.category == 'Western') {
					suggestions.note.add('Western');
					suggestions.tags.add('Uncensored'); // E-Hentai doesn't tag western works as uncensored for some reason
				}

				if (/childhood|osananajimi/.test(title)) {
					suggestions.tags.add('Childhood Friend');
				}
				if (title.includes('tsundere')) {
					suggestions.tags.add('Tsundere');
				}
				if (title.includes('ongoing')) {
					suggestions.note.add('Ongoing');
				}
				if (/boyfriend|husband|wife|girlfriend/.test(title)) {
					suggestions.tags.add('Couple');
				}
				if (/subordinate|boss/.test(title)) {
					suggestions.tags.add('Coworker');
				}

				for (let i = 0; i < siteTags.length; i++) {
					if (siteTags[i] in ehentai.notes) {
						suggestions.note.add(ehentai.notes[siteTags[i] as keyof typeof ehentai.notes]);
					}

					if (siteTags[i] in ehentai.tags) {
						suggestions.tags.add(ehentai.tags[siteTags[i] as keyof typeof ehentai.tags]);
					}
				}
			} else if (url.match(/fakku/)) {
				const fetched = await fetchInfo(message, row);

				if (!fetched || 'error' in fetched) {
					message.channel.send(`Failed to suggest the requested fields! ${fetched.error ?? `Couldn't connect to the site`}`);
					return;
				}

				const title = fetched.title.toLowerCase();
				const fakku = suggestTagsNotes.fakku;
				siteTags.push(...fetched.siteTags.tags);

				if (/boyfriend|husband|wife|girlfriend/.test(title)) {
					suggestions.tags.add('Couple');
				}

				if (/subordinate|boss/.test(title)) {
					suggestions.tags.add('Coworker');
				}

				for (let i = 0; i < siteTags.length; i++) {
					if (siteTags[i] in fakku.notes) {
						suggestions.note.add(fakku.notes[siteTags[i] as keyof typeof fakku.notes]);
					}

					if (siteTags[i] in fakku.tags) {
						suggestions.tags.add(fakku.tags[siteTags[i] as keyof typeof fakku.tags]);
					}
				}
			}

			// Edge cases
			if (suggestions.tags.has('Futanari') && (url.match(/fakku/))) { // FAKKU doesn't have clear tags for Futanari content
				if (suggestions.tags.has('Anal') && !suggestions.tags.has('Yuri')) {
					suggestions.note.add('Futa on Male');
					suggestions.tags.delete('Anal');
				} else {
					suggestions.note.add('Futa on Female / Futa on Futa (pick whichever note is accurate)');
				}
			} else if (suggestions.tags.has('Futanari') && !(suggestions.note.has('Futa on Male') || suggestions.note.has('Futa on Futa') || suggestions.note.has('Male on Futa'))) { // E-Hentai doesn't have a Futa on Female tag
				suggestions.note.add('Futa on Female');
				suggestions.tags.add('Yuri');
			}

			if (suggestions.note.has('Incest') && suggestions.note.has('Inseki')) { // E-Hentai uses both incest and inseki tags for an inseki work
				suggestions.note.delete('Incest');
			}

			if (suggestions.tags.has('Anal') && suggestions.tags.has('Yaoi')) { // FAKKU and E-Hentai use anal for yaoi works
				suggestions.tags.delete('Anal');
			}

			if (suggestions.note.has('Crossdressing') && suggestions.note.has('Crossdressing Boy')) { // FAKKU doesn't differentiate between crossdressing boy and girls
				suggestions.note.delete('Crossdressing');
			}

			if (suggestions.tags.size || suggestions.note.size) {
				const tagsString = suggestions.tags.size && !fields?.includes('note') ? `Suggested tags: **${[...suggestions.tags].sort().join(', ')}**` : '';
				const noteString = suggestions.note.size && !fields?.includes('tag') ? `\nSuggested note: **${[...suggestions.note].sort().join(', ')}**` : '';

				message.channel.send(`${tagsString + noteString}\nRemember that these suggestions are not exhaustive, as they are done automatically based on the tags, so make sure they are accurate!`);
			} else if (fields) {
				message.channel.send(`Couldn't find any tags/notes to suggest`);
			}
		} catch (e) {
			message.channel.send('Failed to suggest the requested fields!');
			return;
		}
	}
}

/**
 * Fetch information from E-hentai/FAKKU/nhentai
 */
export async function fetchInfo(message: Message, row: Row) {
	const url = row.eh && row.eh != 'null' ? row.eh : row.nh ?? '';

	if (!url.match(/e-hentai|nhentai|fakku/)) {
		return { error: 'Invalid link. Can only fetch information from E-Hentai, nhentai, or FAKKU!' };
	} else {
		try {
			let title = '';
			let author = '';
			let parodies: string[] = [];
			let characters: string[] = [];
			let tags: string[] = [];
			const siteTags: { tags: string[]; characters: string[] } = {
				tags: [],
				characters: [],
			};

			if (url.match(/e-hentai/)) {
				const data = await fetchEHApi(url);

				title = decode(
					data.title.match(
						/^(?:\s*(?:=.*?=|<.*?>|\[.*?]|\(.*?\)|\{.*?})\s*)*(?:[^[|\](){}<>=]*\s*\|\s*)?([^[|\](){}<>=]*?)(?:\s*(?:=.*?=|<.*?>|\[.*?]|\(.*?\)|\{.*?})\s*)*$/
					)?.[1].trim());

				author = data.tags
					.filter((s: string) => s.match(/artist/))
					.map((s: string) => decode(capitalize(s.match(/artist:(.*)/)![1])))
					.join(', ');
				
				const authorRegex = new RegExp(`(${author})`, "i");

				if (authorRegex.test(data.title)) {
					author = data.title.match(authorRegex)[0];
				}

				parodies = data.tags
					.filter((s: string) => s.match(/parody/))
					.map((s: string) => decode(capitalize(s.match(/parody:(.*)/)![1])))
					.filter((s: string) => s !== 'Original');

				characters = data.tags
					.filter((s: string) => s.match(/character/))
					.map((s: string) => decode(s.match(/character:(.*)/)![1]));

				tags = data.tags
					.filter((s: string) => s.match(/(female|male|mixed|other):/) && !ignoredTags.includes(s.match(/:(.*)/)![1]));

			} else if (url.match(/nhentai/)) {
				//return { error: 'Only nhentai link found, not auto-setting info. **Please remember to manually add the missing information to the entry**' };
				const data = await fetchNHApi(url);

				title = decode(
					data.title.english.match(
						/^(?:\s*(?:=.*?=|<.*?>|\[.*?]|\(.*?\)|\{.*?})\s*)*(?:[^[|\](){}<>=]*\s*\|\s*)?([^[|\](){}<>=]*?)(?:\s*(?:=.*?=|<.*?>|\[.*?]|\(.*?\)|\{.*?})\s*)*$/
					)?.[1].trim());

				author = data.tags
					.filter((o: Tags) => o.type == 'artist')
					.map((o: Tags) => decode(capitalize(o.name)).split('|')[0].trim())
					.join(', ');

				const authorRegex = new RegExp(`(${author})`, "i");

				if (authorRegex.test(data.title.english)) {
					author = data.title.english.match(authorRegex)[0];
				}

				parodies = data.tags
					.filter((o: Tags) => o.type == 'parody' && o.name != 'original')
					.map((o: Tags) => decode(capitalize(o.name)));

				characters = data.tags
					.filter((o: Tags) => o.type == 'character')
					.map((o: Tags) => decode(capitalize(o.name)));

				tags = data.tags
					.filter((o: Tags) => o.type == 'tag' && !ignoredTags.includes(o.name))
					.map((o: Tags) => decode(o.name));
			} else if (url.match(/fakku/)) {
				const response = axios.get(url).then((resp: AxiosResponse) => {
					const respdata = resp?.data;

					if (!respdata) {
						throw new Error(`No response body found.`);
					}

					return respdata;
				});

				const body = await response;
				const soup = new JSSoup(body);

				title = decode(
					soup
						.find('h1')
						.text);

				author = decode(
					soup
						.find('title')
						.text.match(
						/ by (?!.* by )(.+) - FAKKU/
						)[1].trim());

				parodies = soup
					.findAll('a')
					.filter((s: { attrs: { href: string } }) => {
						return s?.attrs?.href?.match(/\/series\/.+/);
					})
					.map((s: { text: string }) => {
						return decode(s.text.replace(/\sseries/i, '').trim());
					})
					.filter((s: string) => s !== 'Original Work');

				tags = soup
					.findAll('a', 'leading-loose')
					.filter((s: { attrs: { href: string; title: string } }) => {
						return s?.attrs?.href?.match(/\/(?:tags\/.+|unlimited)/) || s?.attrs?.title?.match(/Read With.+/i);
					})
					.map((s: { text: string }) => {
						return decode(s.text.replace(/Read With.+/i, 'unlimited').toLowerCase().trim());
					})
					.filter((s: string) => s !== 'hentai');
			}

			if (tags?.length) {
				siteTags.tags = [...tags];
			}

			if (author?.length) {
				if (author.toLowerCase() in renameAuthors) {
					author = renameAuthors[author.toLowerCase() as keyof typeof renameAuthors];
				}
			}

			if (characters?.length) {
				underageCheck(characters, parodies, message);
				for (let t = 0; t < characters.length; t++) {
					if (characters[t] in renameCharacters) {
						characters[t] = renameCharacters[characters[t] as keyof typeof renameCharacters];
					}
				}

				siteTags.characters = [...characters];
			}

			if (parodies?.length) {
				for (let u = 0; u < parodies.length; u++) {
					for (const [key, value] of Object.entries(renameParodies)) {
						if (value.includes(parodies[u])) {
							parodies[u] = key;
							break;
						}
					}
				}
				parodies = [...new Set(parodies)]; //removes duplicates if they exist
			}

			return {
				title,
				author,
				parodies,
				siteTags,
			};
		} catch (e) {
			const site = url.match(/\/\/(www\.)?([\w-]*)\./)![2] ?? 'some website';

			if (axios.isAxiosError(e) && (e?.response?.status === 403 || e?.response?.status === 503)) {
				console.log(`Error ${e.response.status}: Couldn't connect to ${site}!`);
				return { error: `Failed to connect to ${site}: Error ${e.response.status} (likely nhentai has cloudflare up). Failed to get missing information.` };
			} else {
				console.log(e);
				return { error: `Failed to get missing information from ${site}!` };
			}
		}
	}
}
