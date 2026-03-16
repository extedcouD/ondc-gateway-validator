# ONDC Validator

A validation server for ONDC messages. Point it at your build YAMLs, spin up the container, and send raw ONDC payloads to get validation results back.

---

## Usage

### 1. Add your config files

Place your `build.yaml` files inside the `build-output/config/` folder.

### 2. Generate the ONIX server

```bash
npm run build && npm start
```

### 3. Start the container

```bash
cd build-output
docker compose up --build
```

### 4. Send validation requests

```
POST http://localhost:3001/ondc/<DOMAIN>/<VERSION>/validate/<ACTION>
```

---

## Example

**Endpoint**

```
POST http://localhost:3001/ondc/ONDC:RET10/1.2.5/validate/search
```

**Request body**

```json
{
    "context": {
        "domain": "ONDC:RET10",
        "country": "IND",
        "city": "std:080",
        "action": "search",
        "core_version": "1.2.5",
        "bap_id": "test_bap_id",
        "bap_uri": "http://test_bap_uri.com",
        "transaction_id": "1234567890",
        "message_id": "1234567890"
    },
    "message": {
        // message body
    }
}
```
