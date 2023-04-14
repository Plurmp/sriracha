import Row from '../row';
import { Message } from 'discord.js';
import info from '../../config/globalinfo.json';
import { log, logError } from './log';
import { update } from './misc';
import { fetchInfo, suggestFields } from './fetch';
import * as sheets from '../sheetops';
import { AxiosResponse, AxiosError } from 'axios';
import Jimp from 'jimp';
import validTags from '../../data/tags.json';
import AWS from 'aws-sdk';
import { Flags } from '../index';
import { ManagedUpload } from 'aws-sdk/lib/s3/managed_upload';
import SendData = ManagedUpload.SendData;
const s3 = new AWS.S3({
	accessKeyId: info.awsId,
	secretAccessKey: info.awsSecret,
});

/**
 * Edits a row from a sheet.
 */
export default async function edit(message: Message, list: number, ID: number, flags: Flags) {
	if (list <= 0 || list > info.sheetNames.length) {
		message.channel.send('Cannot edit from a nonexistent sheet!');
		return false;
	}

	const namespaceWeight = {
		male: 0,
		female: 1,
		mixed: 2,
		other: 3,
	};

	function sortTags(array: string[]): string[] {
		return array.sort(function (a: string, b: string) {
			const aPrefix = namespaceWeight[a.split(':')[0] as keyof typeof namespaceWeight];
			const bPrefix = namespaceWeight[b.split(':')[0] as keyof typeof namespaceWeight];
			if (aPrefix == bPrefix) {
				return a.localeCompare(b);
			}
			return aPrefix < bPrefix ? -1 : aPrefix > bPrefix ? 1 : 0;
		});
	}

	const name = info.sheetNames[list];

	try {
		//we are editing so we fetch whats in the sheet of course
		const rows = await sheets.get(name);

		if (ID == 0 || ID > rows.length) {
			message.channel.send(`Cannot get nonexistent row! The last entry in this sheet is \`${list}#${rows.length}\``);
			return false;
		}

		//for deleting fields
		const target = new Row(rows[ID - 1]);

		for (const property in flags) {
			if (flags[property as keyof Flags]!.toLowerCase() === 'clear') {
				flags[property as keyof Flags] = null;
			}
		}

		//replace tildes
		if (flags.tr?.includes('~')) {
			flags.tr = flags.tr.replace('~', '-');
		}

		//move link to the appropriate flag
		if (flags.l) {
			flags.l = flags.l.replace('http://', 'https://');
			const siteRegex = flags.l.match(/hmarket|nhentai|e-hentai|imgur|fakku|irodoricomics|ebookrenta/);

			if (!siteRegex) {
				message.channel.send('Link from unsupported site detected! Please try to only use links from Hmarket, nhentai, E-hentai, Imgur, FAKKU, Idodori, or Renta!');
				console.log('Link from unsupported site! This should never happen');
			} else {
				const site = siteRegex[0];

				switch (site) {
					case 'hmarket':
						flags.l1 = flags.l;
						delete flags.l;
						break;
					case 'nhentai':
					case 'fakku':
					case 'irodoricomics':
					case 'ebookrenta':
						flags.l2 = flags.l;
						delete flags.l;
						break;
					case 'e-hentai':
						flags.l3 = flags.l;
						delete flags.l;
						break;
					case 'imgur':
						flags.l4 = flags.l;
						delete flags.l;
						break;
				}
			}
		}

		// Change links to HTTPS
		flags.l1 &&= flags.l1.replace('http://', 'https://');
		flags.l2 &&= flags.l2.replace('http://', 'https://');
		flags.l3 &&= flags.l3.replace('http://', 'https://');
		flags.l4 &&= flags.l4.replace('http://', 'https://').replace(/m\.imgur\.com|imgur\.io/, 'imgur.com');

		//misc editing detected!!
		if (flags.addalt || flags.delalt || flags.addseries || flags.delseries || flags.fav || flags.fav === null || flags.r || flags.r === null) {
			const miscField = JSON.parse(target.misc ?? '{}');

			if (flags.addalt) {
				if (flags.addalt.includes('http')) {
					flags.addalt = flags.addalt.replace('http://', 'https://').replace(/m\.imgur\.com|imgur\.io/, 'imgur.com');

					//create object structure if necessary and push the necessary info to the array
					miscField.altLinks ??= [];

					const altLinks = flags.addalt.split(',').map((s) => s.trim());

					miscField.altLinks.push({
						link: altLinks[0],
						name: altLinks[1],
					});
				} else {
					message.channel.send(`Failed to add the alternative link to entry \`${list}#${ID}\`. The alt is missing a link!`);
				}
			}

			if (flags.delalt) {
				if (miscField.altLinks) {
					const altLength = miscField.altLinks.length;

					for (let i = altLength - 1; i >= 0; i--) {
						if (miscField.altLinks[i].name === flags.delalt) {
							miscField.altLinks.splice(i, 1);
						} //delete operations calls for splicing the array to the requested field
					}
					if (altLength == miscField.altLinks.length) {
						message.channel.send(`Entry \`${list}#${ID}\` did not contain the alt link \`${flags.delalt}\`!`);
					} else if (!miscField.altLinks.length) {
						delete miscField.altLinks; //get rid of the object structure if theres nothing left after delete
					}
				}
			}

			if (flags.addseries) {
				miscField.series ??= [];

				const series = flags.addseries.split(',').map((s) => s.trim());

				if (series.length <= 2) {
					message.channel.send(`Failed to add the \`${series[0]}\` series to entry \`${list}#${ID}\`! The command requires 3 values (name, type, and number)!`);
				} else {
					if (series.length > 3) {
						series.unshift(series.splice(0, series.length - 2).join(', '));
					}

					if (series[1].toLowerCase() == 'series' || series[1] == 'anthology') {
						const sameSeries = miscField.series.filter((o: Record<string, string | number>) => o.name == series[0]);

						if (sameSeries.length) {
							miscField.series = miscField.series.filter((o: Record<string, string | number>) => o.name != series[0]);
						}

						//same as adding an altlink above
						miscField.series.push({
							name: series[0],
							type: series[1],
							number: +series[2],
						});
						message.channel.send(`Successfully added the \`${series[0]}\` series to entry \`${list}#${ID}\`!`);
					} else {
						message.channel.send(`Failed to add the \`${series[0]}\` series to entry \`${list}#${ID}\`! \`${series[1]}\` is not a valid type!`);
					}
				}
			}

			if (flags.delseries) {
				if (miscField.series) {
					const seriesLength = miscField.series.length;

					for (let i = seriesLength - 1; i >= 0; i--) {
						if (miscField.series[i].name === flags.delseries) {
							miscField.series.splice(i, 1);
						}
					}
					if (seriesLength == miscField.series.length) {
						message.channel.send(`Entry \`${list}#${ID}\` did not contain the series \`${flags.delseries}\`!`);
					} else if (!miscField.series.length) {
						delete miscField.series;
					}
				}
			}

			//favorites are just a single field, easy to add and remove
			if (flags.fav === null) {
				delete miscField.favorite;
			}
			if (flags.fav) {
				miscField.favorite = flags.fav;
			}

			if (flags.r === null) {
				delete miscField.r;
			}
			if (flags.r) {
				miscField.reason = flags.r;
			}

			if (!Object.keys(miscField).length) {
				target.misc = null;
			} else {
				target.misc = JSON.stringify(miscField);
			}
		}

		//edit the sitetags field
		if (flags.addcharacter || flags.delcharacter || flags.addsitetag || flags.delsitetag) {
			const siteTags = JSON.parse(target.siteTags ?? '{}');

			if (flags.addcharacter || flags.delcharacter) {
				const char = flags.addcharacter?.toLowerCase() ?? flags.delcharacter?.toLowerCase();

				if (flags.addcharacter) {
					siteTags.tags ??= [];
					siteTags.characters ??= [];

					if (siteTags.characters.includes(char)) {
						message.channel.send(`Character \`${char}\` already exists on this entry!`);
					} else {
						siteTags.characters.push(char);
						siteTags.characters.sort();
						message.channel.send(`Successfully added \`${char}\` to entry \`${list}#${ID}\`!`);
					}
				}

				if (flags.delcharacter) {
					if (!siteTags.characters || !siteTags.characters.length) {
						message.channel.send(`Entry \`${list}#${ID}\` does not contain characters!`);
					} else {
						if (siteTags.characters.includes(char)) {
							siteTags.characters = siteTags.characters.filter((s: string) => s != char);
							message.channel.send(`Successfully deleted \`${char}\` in entry \`${list}#${ID}\`!`);
						} else {
							message.channel.send(`Entry \`${list}#${ID}\` did not contain the character \`${char}\`!`);
						}
					}
				}
			}

			if (flags.addsitetag) {
				const newTag = flags.addsitetag.toLowerCase().split(',').map((s) => s.trim());

				if (!siteTags.tags || !siteTags.tags.length) {
					siteTags.tags = [...newTag];
					message.channel.send(`Successfully added the \`${newTag.join(', ')}\` site tag/s to entry \`${list}#${ID}\`!`);
				} else {
					for (let i = 0; i < newTag.length; i++) {
						if (siteTags.tags.includes(newTag[i])) {
							message.channel.send(`That site tag \`${newTag[i]}\` already exists on this entry. Ignoring...`);
						} else if (newTag[i].includes(':') && siteTags.tags[0].includes(':')) {
							const prefix = newTag[i].split(':')[0];

							if (prefix in namespaceWeight) {
								siteTags.tags.push(newTag[i]);
								sortTags(siteTags.tags);
								message.channel.send(`Successfully added the \`${newTag[i]}\` site tag to entry \`${list}#${ID}\`!`);
							} else {
								message.channel.send(`Failed to add the \`${newTag[i]}\` site tag to entry \`${list}#${ID}\`! \`${prefix}\` is not a valid namespace!`);
							}
						} else if (newTag[i].includes(':') && !siteTags.tags[0].includes(':')) {
							message.channel.send(`Failed to add \`${newTag[i]}\` to entry \`${list}#${ID}\`! Site tags in the entry don't have namespaces!`);
						} else if (!newTag[i].includes(':') && siteTags.tags[0].includes(':')) {
							message.channel.send(`Failed to add \`${newTag[i]}\` to entry \`${list}#${ID}\`! Site tag is missing a namespace (male, female, mixed, or other)!`);
						} else {
							siteTags.tags.push(newTag[i]);
							message.channel.send(`Successfully added the \`${newTag[i]}\` site tag to entry \`${list}#${ID}\`!`);
						}
					}
				}

				siteTags.characters ??= [];
			}

			if (flags.delsitetag) {
				const delTag = flags.delsitetag.toLowerCase().split(',').map((s) => s.trim());

				if (!siteTags.tags || !siteTags.tags.length) {
					message.channel.send(`Entry \`${list}#${ID}\` does not contain site tags!`);
				} else {
					for (let i = 0; i < delTag.length; i++) {
						if (!delTag[i].includes(':') && siteTags.tags[0].includes(':')) {
							message.channel.send(`Failed to delete \`${delTag[i]}\` from  entry \`${list}#${ID}\`! Site tag is missing a namespace (male, female, mixed, or other)!`);
						} else {
							if (delTag[i].includes(':') && !siteTags.tags[0].includes(':')) {
								delTag[i] = delTag[i].split(':')[1];
							}

							if (siteTags.tags.includes(delTag[i])) {
								siteTags.tags = siteTags.tags.filter((s: string) => s != delTag[i]);
								message.channel.send(`Successfully deleted the \`${delTag[i]}\` site tag from entry \`${list}#${ID}\`!`);
							} else {
								message.channel.send(`Entry \`${list}#${ID}\` did not contain the site tag \`${delTag[i]}\`!`);
							}
						}
					}
				}
			}

			if (!Object.keys(siteTags).length) {
				target.siteTags = null;
			} else {
				target.siteTags = JSON.stringify(siteTags);
			}
		}

		if (flags.fetch) {
			const fetchRegex = flags.fetch.match(/^(all|artist|author|character|parody|sitetag|tag|title)/);

			if (!fetchRegex) {
				message.channel.send('Invalid fetching option! Please only use `all`, `artist/author`, `characters`, `parody`, `sitetags/tags`, or `title`.');
			} else {
				const fetched = await fetchInfo(message, target);

				if (!fetched || 'error' in fetched) {
					message.channel.send(`Unable to fetch the requested fields! ${fetched.error ?? ''}`);
				} else {
					const fetchFields = fetchRegex[0];

					let siteTags: { tags: string[]; characters: string[] } = {
						tags: [],
						characters: [],
					};

					if (target.siteTags) {
						siteTags = JSON.parse(target.siteTags);
					}

					switch (fetchFields) {
						case 'all':
							target.author = fetched.author;
							target.parody = fetched.parodies.join(', ');
							target.title = fetched.title;
							target.siteTags = JSON.stringify(fetched.siteTags);
							break;
						case 'artist':
						case 'author':
							target.author = fetched.author;
							break;
						case 'character':
							siteTags.characters = [...fetched.siteTags.characters];
							target.siteTags = JSON.stringify(siteTags);
							break;
						case 'parody':
							target.parody = fetched.parodies.join(', ');
							break;
						case 'sitetag':
						case 'tag':
							siteTags.tags = [...fetched.siteTags.tags];
							target.siteTags = JSON.stringify(siteTags);
							break;
						case 'title':
							target.title = fetched.title;
							break;
						default:
							break;
					}

					message.channel.send('Successfully fetched the requested fields!');
				}
			}
		}
		if (flags.suggest) {
			const fields = flags.suggest?.toLowerCase();

			if (/all|tag|note/.test(fields)) {
				await suggestFields(message, target, fields);
			} else {
				message.channel.send('Failed to suggest requested fields! Valid options are `all, tags, or note`!');
			}
		}

		const r = new Row(flags);

		// Update the entry with the commands provided
		target.update(r);

		if (flags?.rtag) {
			const tags = flags.rtag.split(',').map((s) => s.trim());

			if (list === 1) {
				message.channel.send("**Don't edit tags in `New Finds`! Make sure it has been QCed before moving them to `Unsorted` to apply tags!**");
			} else {
				for (let i = 0; i < tags.length; i++) {
					tags[i] = tags[i].replace(/(?:^|\s+)(\w{1})/g, (letter) => letter.toUpperCase()); //make sure the tag is capitalized

					const result = target.rtag(tags[i]);

					if (result) {
						message.channel.send(`Successfully deleted the \`${tags[i]}\` tag in entry \`${list}#${ID}\`!`);
					} else {
						message.channel.send(`Entry \`${list}#${ID}\` did not contain the tag \`${tags[i]}\`.`);
					}
				}
			}
		}

		if (flags?.atag) {
			const tags = flags.atag.split(',').map((s) => s.trim());

			if (list === 1) {
				message.channel.send("**Don't edit tags in `New Finds`! Make sure it has been QCed before moving them to `Unsorted` to apply tags!**");
			} else {
				for (let i = 0; i < tags.length; i++) {
					tags[i] = tags[i].replace(/(?:^|\s+)(\w{1})/g, (letter) => letter.toUpperCase()); //make sure the tag is capitalized

					if (!validTags.includes(tags[i])) {
						message.channel.send(`**Invalid tag \`${tags[i]}\` detected!** For a list of valid tags, use \`sauce tags\`.`);
					} else {
						const result = target.atag(tags[i]);

						if (result) {
							message.channel.send(`Successfully added the \`${tags[i]}\` tag to entry \`${list}#${ID}\`!`);
						} else {
							message.channel.send(`That tag \`${tags[i]}\` already exists on this entry. Ignoring...`);
						}
					}
				}
			}
		}

		if (flags?.img) {
			if (list === 4 || list === 9) { // image was updated and it's one of the final lists
				const imageLocation = target.img!;

				console.log(imageLocation);
				message.channel.send('Downloading `' + imageLocation + '` and converting to JPG...');

				const image = await Jimp.read(imageLocation);
				if (image.bitmap.width > 350) {
					await image.resize(350, Jimp.AUTO);
				}
				image.quality(70);
				const data = await image.getBufferAsync(Jimp.MIME_JPEG);

				const params = {
					Bucket: info.awsBucket,
					Key: target.uid + '.jpg',
					Body: data,
					ContentType: 'image/jpeg',
					ACL: 'public-read-write',
				};
				await new Promise<void>((resolve, reject) => {
					s3.upload(params, (err: Error, data: SendData) => {
						if (err) {
							reject(err);
							return;
						}

						target.img = 'https://wholesomelist.com/asset/' + target.uid + '.jpg';
						resolve();
						return;
					});
				});
				message.channel.send(`Uploaded! The thumbnail can now be found at \`${target.img}\``);
			}
		}

		//convert back to A1 notation
		await sheets.overwrite(name, ID + 1, target.toArray());

		message.channel.send(`\`${list}#${ID}\` updated successfully!`);

		if (list == 4 || list == 9) {
			await update()
				.then((resp: AxiosResponse) => {
					message.channel.send(`\`${list}#${ID}\` was pushed to the website with code ${resp.status}`);
					if (resp.status == 200) return;
					else throw resp;
				})
				.catch((err: Error | AxiosError) => {
					message.channel.send(`\`${list}#${ID}\` was not updated on the website. Please run \`sauce update\`!`);
					logError(message, err);
				})
				.finally(() => {
					log('Update promise resolved.');
				});
		}
		return true;
	} catch (e) {
		logError(message, e);
		return false;
	}
}
