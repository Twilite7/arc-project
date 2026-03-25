#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiI5YjdiMTY3ZS1lMWY5LTRmODItOTdmMi1jMTY2OGEyYTc0NTMiLCJlbWFpbCI6InNhaW50d2lsaWdodDdAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6ImZiYzU3MDNmOWRjMWQwMzA3NGI3Iiwic2NvcGVkS2V5U2VjcmV0IjoiNmUwNDFjNWU2NjRiMzRkNGU1NDA1Y2RjMWVkNjYyMmQ2MGZjODkzNzE3YmY2MmY2MTFlODc2YTYwMDc2ODMwMiIsImV4cCI6MTgwNTgwNzA5MX0.QeRvi8N2dsF_fBmHwC0riYczjYqWj885E_45TZHwctI"
DIR="$HOME/arc-project/nft-metadata"
CMD="curl --request POST --url https://api.pinata.cloud/pinning/pinFileToIPFS --header 'Authorization: Bearer $JWT' --form 'pinataMetadata={\"name\":\"nft-metadata\"}'"
for f in "$DIR"/*; do
  CMD="$CMD --form 'file=@\"$f\";filename=\"nft-metadata/$(basename $f)\"'"
done
eval $CMD
