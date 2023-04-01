import Row from '../row';
import { Message } from 'discord.js';
import info from '../../config/globalinfo.json';
import { logError, updatePublicServer } from './log';
import pFetch from '../utils/page';
import { entryEmbed, update } from './misc';
import del from './delete';
import sheets from '../sheetops';
import Jimp from 'jimp';
import { v4 as uuidv4 } from 'uuid';
import AWS from 'aws-sdk';
const s3 = new AWS.S3({
	accessKeyId: info.awsId,
	secretAccessKey: info.awsSecret,
});

import { Flags } from '../index';
import fetchThumbnail from '../utils/thumbnail';
import { setFetchedFields } from './fetch';

/**
 * Secondhand function to accept flag object.
 */
export async function flagAdd(message: Message, flags: Flags) {
	if (!flags.l && !flags.l1 && !flags.l2 && !flags.l3 && !flags.l4) {
		message.channel.send('Please provide a link with one of the following flags: `-l`, `-l1` (Hmarket), `-l2` (nhentai), `-l3` (E-Hentai), or `-l4` (Imgur)!');
		return false;
	}

	if (flags.l) {
		flags.l = flags.l.replace('http://', 'https://').replace(/m\.imgur\.com|imgur\.io/, 'imgur.com');
		const siteRegex = flags.l.match(/hmarket|nhentai|e-hentai|imgur|fakku|irodoricomics|ebookrenta/);
		if (!siteRegex) {
			message.channel.send('Link from unsupported site detected! Please try to only use links from Hmarket, nhentai, E-hentai, Imgur, FAKKU, Idodori, or Renta!');
			console.log('Link from unsupported site! This should never happen');
			return false;
		}

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
	// Change links to HTTPS
	flags.l1 &&= flags.l1.replace('http://', 'https://');
	flags.l2 &&= flags.l2.replace('http://', 'https://');
	flags.l3 &&= flags.l3.replace('http://', 'https://').replace(/\?p=\d+/, '');
	flags.l4 &&= flags.l4.replace('http://', 'https://').replace(/m\.imgur\.com|imgur\.io/, 'imgur.com');

	if (flags.atag) {
		message.channel.send("Don't use the `-atag` flag when adding - it won't work! Add the entry and then modify the tags.");
	}
	if (flags.addseries) {
		message.channel.send("Don't use the `-addseries` flag when adding - it won't work! Add the entry and then add the series.");
	}
	if (flags.addalt) {
		message.channel.send("Don't use the `-addalt` flag when adding - it won't work! Add the entry and then add the alt links.");
	}
	if (flags.addcharacter) {
		message.channel.send("Don't use the `-addcharacter` flag when adding - it won't work! Add the entry and then add the missing characters.");
	}
	const row = new Row(flags);
	const list = +(flags?.s ?? 1);

	return add(message, list, row);
}

/**
 * Prepatory things to do before pushing a row to the final list.
 */
function prepUploadOperation(message: Message, list: number, row: Row) {
	// eslint-disable-next-line no-async-promise-executor
	return new Promise<void>(async (resolve, reject) => {
		try {
			if (list != 4 && list != 9) { //if its not going to the final/licensed list, do nothing
				resolve();
				return;
			}

			if (row.page === -1) {
				const urlPage = (row.eh ?? row.im ?? row.nh)!;
				await pFetch(urlPage).then((pages) => {
					row.page = pages;
				});

				if (row.page === -1) {
					message.channel.send('Failed to get page numbers! Please set it manually with `-pg`.');
					reject('*dies of page fetch failure*');
					return;
				}
			}

			if (row.uid && row?.img?.match(/wholesomelist/)) {
				message.channel.send('UUID and image already detected! Not running upload sequence.');
				resolve();
				return;
			}

			// Create UID if the entry doesn't have one
			row.uid ??= uuidv4();

			// Chop off mobile domain and trailing slashes in the links
			row.hm &&= row.hm.replace(/\/$/, '');
			row.nh &&= row.nh.replace(/\/$/, '');
			row.eh &&= row.eh.replace(/\/$/, '');
			row.im &&= row.im.replace(/\/$/, '').replace(/m\.imgur\.com|imgur\.io/, 'imgur.com');

			let imageLocation = null;
			let errorMessage = null;

			console.log('Detecting location of cover image...');
			if (typeof row.img !== 'undefined') {
				imageLocation = row.img;
			} else {
				await fetchThumbnail(message, row).then((data) => {
					imageLocation = data;
				}, (error) => {
					errorMessage = error;
				});
			}

			if (errorMessage) {
				reject(errorMessage);
				return;
			}

			console.log(imageLocation);
			message.channel.send('Downloading `' + imageLocation + '` and converting to JPG...');
			const image = await Jimp.read(imageLocation!);
			if (image.bitmap.height < image.bitmap.width) {
				message.channel.send('The width of this cover image is greater than the height! This results in suboptimal pages on the site. **Please crop and upload an album cover manually using -img!**');
				reject('Epic Image Width Fail');
				return;
				// TODO chop this in half automatically and let the user decide
			}

			if (image.bitmap.width > 350) {
				await image.resize(350, Jimp.AUTO);
			}
			image.quality(70);
			const data = await image.getBufferAsync(Jimp.MIME_JPEG);

			const params = {
				Bucket: info.awsBucket,
				Key: row.uid + '.jpg',
				Body: data,
				ContentType: 'image/jpeg',
				ACL: 'public-read-write',
			};
			await new Promise<void>((resolve, reject) => {
				s3.upload(params, (err: Error) => {
					if (err) {
						reject(err);
						return;
					}

					row.img = 'https://wholesomelist.com/asset/' + row.uid + '.jpg';
					resolve();
					return;
				});
			});
			message.channel.send(`Uploaded! The thumbnail can now be found at \`${row.img}\``);
			resolve();
		} catch (error: any) {
			if (error?.code == 'ETIMEDOUT') {
				message.channel.send('**Failed to fetch cover! Connection to the server timed out.** Try uploading the cover and linking to it using the `-img` command.');
			} else {
				if (error?.message?.includes('Unsupported MIME')) {
					message.channel.send(`**Failed to convert cover to JPG!** Unsupported file format ${error.message.split(': ')[1]} detected!`);
				} else if (error.message?.includes('Could not find MIME for Buffer')) {
					message.channel.send("**Failed to convert cover to JPG!** The link is not valid or doesn't contain an image!")
				}
			}

			reject(error);
		}
	});
}

/**
 * Do everything needed after the upload to the final list.
 */
function postUploadOperation(message: Message, list: number, row: Row) {
	// eslint-disable-next-line no-async-promise-executor
	return new Promise<void>(async (resolve, reject) => {
		if (list != 4) {
			if (list === 9) {
				await update();
				message.channel.send('Updated website!');
			}
			resolve();
			return;
		}
		await update();
		//update public server
		const embed = entryEmbed(row, -1, -1, message);
		embed.setFooter({ text: 'Wholesome God List' });

		updatePublicServer(embed);

		const upRows = await sheets.get('SITEDATA2');

		if (upRows.length > 10) {
			await del(message, 8, 1);
		}

		await sheets.append('SITEDATA2', [row.title, 'https://wholesomelist.com/list/' + row.uid, row.author, row.tier, Date.now()]);
		message.channel.send('Updated public server / website!');
		resolve();
		return;
	});
}

/**
 * Main function that takes a row.
 */
export default async function add(message: Message, list: number, row: Row) {
	if (list <= 0 || list > info.sheetNames.length) {
		message.channel.send('Cannot add to a nonexistent sheet!');
		return false;
	}

	try {
		await prepUploadOperation(message, list, row);

		await setFetchedFields(message, list, row);

		const newRow = await sheets.append(info.sheetNames[list], row.toArray());
		await message.channel.send(`Successfully added \`${list}#${newRow - 1}\`!`);

		await postUploadOperation(message, list, row);

		return true;
	} catch (e) {
		logError(message, e);
		return false;
	}
}
