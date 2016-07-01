// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');

// constants
var MAX_WIDTH  = 500;
var MAX_HEIGHT = 500;

// S3 and DynamoDB clients
var s3 = new AWS.S3();
var db = new AWS.DynamoDB.DocumentClient();

exports.handler = function(event, context, callback) {
  // Read options from the event.
  console.log('Reading options from event:\n', util.inspect(event, {depth: 5}));
  var srcBucket = event.Records[0].s3.bucket.name;
  // Object key may have spaces or unicode non-ASCII characters.
  var srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
  var dstBucket = srcBucket + '-resized'; // destination bucket name
  // username-picture-orig.extension --> username-picture-500.extension
  var dstKey    = srcKey.replace('orig', '500');
  // construct table name (appending 'dev' if the source bucket is a devlopment bucket)
  var dbTable = 'UserImages';
  if(srcBucket.indexOf('dev') > -1) {
    dbTable = 'dev' + dbTable;
  }

  // Sanity check: validate that source and destination are different buckets.
  if (srcBucket == dstBucket) {
    callback("Source and destination buckets are the same.");
    return;
  }

  // Infer the image type.
  var typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    callback('Could not determine the image type.');
    return;
  }
  var imageType = typeMatch[1];

  // IMPORTANT: Only these filetypes will be resized!
  var validTypes = ['jpg', 'JPG', 'jpe', 'JPE', 'jpeg', 'JPEG', 'png', 'PNG', 'bmp', 'BMP'];
  if (validTypes.indexOf(imageType) == -1) {
    callback('Unsupported image type: ${imageType}');
    return;
  }

  // Download the image from S3, transform, and upload to a different S3 bucket.
  async.waterfall([
    function download(next) {
      // Download the image from S3 into a buffer.
      s3.getObject({
        Bucket: srcBucket,
        Key: srcKey
      }, next);
    },
    function transform(response, next) {
      gm(response.Body).size(function(err, size) {
        // Infer the scaling factor to avoid stretching the image unnaturally.
        var scalingFactor = Math.min(
          MAX_WIDTH / size.width,
          MAX_HEIGHT / size.height
        );
        var width  = scalingFactor * size.width;
        var height = scalingFactor * size.height;

        // Transform the image buffer in memory.
        this.resize(width, height)
          .toBuffer(imageType, function(err, buffer) {
            if (err) {
              next(err);
            } else {
              next(null, response.ContentType, buffer);
            }
          });
      });
    },
    function upload(contentType, data, next) {
      // Stream the transformed image to a different S3 bucket.
      s3.putObject({
        Bucket: dstBucket,
        Key: dstKey,
        Body: data,
        ContentType: contentType
      }, next);
    },
    function save(err, data, next) {
      if(err) {
        next(err);
      } else {
        // Save the reference in the database
        db.put({
          TableName: dbTable,
          Item: {
            id: srcKey.substr(0, srcKey.indexOf('-orig')),
            date: new Date().getTime(),
            filename: srcKey
          }
        }, next);
      }
    }
    ], function (err) {
      if (err) {
        console.error(
          'Unable to resize ' + srcBucket + '/' + srcKey +
          ' and upload to ' + dstBucket + '/' + dstKey +
          ' due to an error: ' + err
        );
      } else {
        console.log(
          'Successfully resized ' + srcBucket + '/' + srcKey +
          ' and uploaded to ' + dstBucket + '/' + dstKey
        );
      }
      callback(null, "message");
    }
  );
};
