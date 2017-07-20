const async = require('async');
const AWS = require('aws-sdk');
const gm = require('gm').subClass({ imageMagick: true });
const util = require('util');

const db = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

exports.handler = (event, context, callback) => {
  console.log('Reading options from event:\n', util.inspect(event, {depth: 5}));

  // Object key may have spaces or unicode non-ASCII characters.
  const srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
  const srcBucket = event.Records[0].s3.bucket.name;
  const dstBucket = `${srcBucket}-resized`;

  // Construct filenames for resized images.
  // username-picture-orig.ext --> username-picture-200.ext (thumb)
  // username-picture-orig.ext --> username-picture-640.ext
  // username-cover-orig.ext --> username-cover-800.ext (thumb)
  // username-cover-orig.ext --> username-cover-1920.ext
  let dstKey;
  let dstKeyThumb;
  let MAX_HEIGHT;
  let MAX_WIDTH;
  let THUMB_HEIGHT;
  let THUMB_WIDTH;

  if (srcKey.includes('picture')) {
    dstKey = srcKey.replace('orig', '640');
    dstKeyThumb = srcKey.replace('orig', '200');
    MAX_HEIGHT = 640;
    MAX_WIDTH = 640;
    THUMB_HEIGHT = 200;
    THUMB_WIDTH = 200;
  }
  else if (srcKey.includes('cover')) {
    dstKey = srcKey.replace('orig', '1920');
    dstKeyThumb = srcKey.replace('orig', '800');
    MAX_HEIGHT = 1920;
    MAX_WIDTH = 1920;
    THUMB_HEIGHT = 800;
    THUMB_WIDTH = 800;
  }
  else {
    callback('Invalid source bucket key.');
    return;
  }

  // Construct table name (prepend 'dev' to devlopment buckets).
  let dbTable;

  if (srcBucket.includes('user-images')) {
    dbTable = 'UserImages';
  }
  else if (srcBucket.includes('branch-images')) {
    dbTable = 'BranchImages';
  }
  else if (srcBucket.includes('post-images')) {
    dbTable = 'PostImages';
  }

  if (srcBucket.includes('dev')) {
    dbTable = `dev${dbTable}`;
  }

  // Sanity check: source and destination buckets must be different.
  if (srcBucket === dstBucket) {
    callback('Source and destination buckets are the same.');
    return;
  }

  // Infer the image type.
  const typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    callback('Could not determine the image type.');
    return;
  }
  const imageType = typeMatch[1].toLowerCase();

  // Only these filetypes will be resized.
  const validImageTypes = [
    'jpg',
    'jpe',
    'jpeg',
    'png',
    'bmp',
  ];
  if (!validImageTypes.includes(imageType)) {
    callback(`Unsupported image type: ${imageType}`);
    return;
  }

  // Download the image from S3, transform, and upload to a different S3 bucket.
  async.waterfall([
    function download (next) {
      s3.getObject({
        Bucket: srcBucket,
        Key: srcKey,
      }, next);
    },
    function transform (response, next) {
      gm(response.Body).size(function (err, size) {
        // Infer the scaling factor to avoid stretching the image unnaturally.
        const scalingFactor = Math.min(MAX_WIDTH / size.width, MAX_HEIGHT / size.height);
        const scalingFactorThumb = Math.min(THUMB_WIDTH / size.width, THUMB_HEIGHT / size.height);

        const height = scalingFactor * size.height;
        const width = scalingFactor * size.width;
        const heightThumb = scalingFactorThumb * size.height;
        const widthThumb = scalingFactorThumb * size.width;

        const self = this;
        self.resize(width, height).toBuffer(imageType, (err, buffer) => {
          if (err) {
            return next(err);
          }

          self.resize(widthThumb, heightThumb).toBuffer(imageType, (err, bufferThumb) => {
            if (err) {
              return next(err);
            }

            return next(null, response.ContentType, buffer, bufferThumb);
          });
        });
      });
    },
    function upload (ContentType, Body, dataThumb, next) {
      s3.putObject({
        Body,
        Bucket: dstBucket,
        ContentType,
        Key: dstKey,
      }, (err, data) => {
        if (err) {
          return next(err);
        }

        s3.putObject({
          Body: dataThumb,
          Bucket: dstBucket,
          ContentType,
          Key: dstKeyThumb,
        }, (err, data) => {
          if(err) {
            return next(err);
          }

          db.put({
            Item: {
              date: new Date().getTime(),
              id: srcKey.substr(0, srcKey.indexOf('-orig')),
              extension: imageType,
            },
            TableName: dbTable,
          }, next);
        });
      });
    }
  ], err => {
    const src = `${srcBucket}/${srcKey}`;
    const dest = `${dstBucket}/${dstKey}`;

    if (err) {
      console.error(`Unable to resize ${src} and upload to ${dest} due to an error: ${err}`);
    }
    else {
      console.log(`Successfully resized ${src} and uploaded to ${dest}`);
    }

    callback(null, 'message');
    return;
  });
};
