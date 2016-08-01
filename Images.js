// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');

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

  // construct filenames for resized images:
  // username-picture-orig.extension --> username-picture-200.extension (thumb)
  // username-picture-orig.extension --> username-picture-640.extension
  // username-cover-orig.extension --> username-cover-800.extension     (thumb)
  // username-cover-orig.extension --> username-cover-1920.extension
  var dstKey;
  var dstKeyThumb;
  var MAX_WIDTH, MAX_HEIGHT;
  var THUMB_WIDTH, THUMB_HEIGHT;
  if(srcKey.indexOf('picture') > -1) {
    dstKey = srcKey.replace('orig', '640');
    dstKeyThumb = srcKey.replace('orig', '200');
    MAX_WIDTH = 640;
    MAX_HEIGHT = 640;
    THUMB_WIDTH = 200;
    THUMB_HEIGHT = 200;
  } else if(srcKey.indexOf('cover') > -1) {
    dstKey = srcKey.replace('orig', '1920');
    dstKeyThumb = srcKey.replace('orig', '800');
    MAX_WIDTH = 1920;
    MAX_HEIGHT = 1920;
    THUMB_WIDTH = 800;
    THUMB_HEIGHT = 800;
  } else {
    callback("Invalid source bucket key.");
    return;
  }

  // construct table name (appending 'dev' if the source bucket is a devlopment bucket)
  var dbTable;
  if(srcBucket.indexOf('user-images') > -1) {
    dbTable = 'UserImages';
  } else if(srcBucket.indexOf('branch-images') > -1) {
    dbTable = 'BranchImages';
  }
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
        var scalingFactorThumb = Math.min(
          THUMB_WIDTH / size.width,
          THUMB_HEIGHT / size.height
        );

        var width  = scalingFactor * size.width;
        var height = scalingFactor * size.height;
        var widthThumb  = scalingFactorThumb * size.width;
        var heightThumb = scalingFactorThumb * size.height;

        // Transform the image buffer in memory.
        var _this = this;
        _this.resize(width, height)
          .toBuffer(imageType, function(err, buffer) {
            if (err) {
              next(err);
            } else {
              _this.resize(widthThumb, heightThumb)
                .toBuffer(imageType, function(err, bufferThumb) {
                  if (err) {
                    next(err);
                  } else {
                    next(null, response.ContentType, buffer, bufferThumb);
                  }
                });
            }
          });
      });
    },
    function upload(contentType, data, dataThumb, next) {
      // upload the resized image
      s3.putObject({
        Bucket: dstBucket,
        Key: dstKey,
        Body: data,
        ContentType: contentType
      }, function(err, data) {
        if(err) {
          return next(err);
        }

        // upload the thumb image
        s3.putObject({
          Bucket: dstBucket,
          Key: dstKeyThumb,
          Body: dataThumb,
          ContentType: contentType
        }, function(err, data) {
          if(err) {
            return next(err);
          }
          // Save the reference in the database
          db.put({
            TableName: dbTable,
            Item: {
              id: srcKey.substr(0, srcKey.indexOf('-orig')),
              date: new Date().getTime(),
              extension: imageType
            }
          }, next);
        });
      });
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
